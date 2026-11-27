import { Router } from 'express';
import { db, now, tx } from '../db.js';
import { audit } from '../audit.js';
import { post, balance } from '../ledger.js';
import * as psp from '../psp.js';
import { parse, fail, z, clientIp } from '../http.js';
import { requireAuth, requireVerified } from '../auth.js';
import { publicUser, systemMessage, notify } from '../services.js';
import { listMessages, zMessage } from './deals.js';
import { me } from './auth.js';

const r = Router();
r.use(requireAuth);

// Публичный профиль и отзывы
r.get('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(String(req.params.id));
  if (!u) fail(404, 'User not found');
  const reviewList = db.prepare(`SELECT r.rating, r.comment, r.created_at AS at, a.name AS author, d.title AS deal
     FROM reviews r JOIN users a ON a.id = r.author_id JOIN deals d ON d.id = r.deal_id
     WHERE r.target_id = ? ORDER BY r.id DESC LIMIT 50`).all(u.id);
  res.json({ ...publicUser(u), reviewList });
});

// Уведомления
r.get('/notifications', (req, res) => {
  res.json(db.prepare('SELECT id, text, link, is_read AS read, created_at AS at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id));
});
r.post('/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// Баланс и история операций
r.get('/wallet', (req, res) => {
  const ops = db.prepare(`SELECT l.id, l.kind, l.amount_cents AS amountCents, l.description, l.created_at AS at, d.code AS dealCode, l.deal_id AS dealId
     FROM ledger l LEFT JOIN deals d ON d.id = l.deal_id WHERE l.user_id = ? ORDER BY l.id DESC LIMIT 200`).all(req.user.id);
  res.json({ balanceCents: balance('user:' + req.user.id), operations: ops });
});

r.post('/wallet/withdraw', (req, res) => {
  requireVerified(req);
  const b = parse(z.object({ amountCents: z.number().int().min(100) }), req.body);
  const key = String(req.get('idempotency-key') || '');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) fail(400, 'Idempotency-Key header is required');
  const result = tx(() => {
    const prev = db.prepare("SELECT response FROM idempotency WHERE user_id = ? AND key = ? AND scope = 'withdraw'").get(req.user.id, key);
    if (prev) return JSON.parse(prev.response);
    const bal = balance('user:' + req.user.id);
    if (b.amountCents > bal) fail(400, 'Insufficient funds');
    const po = psp.payout(req.user.card_token, b.amountCents);
    if (!po.ok) fail(402, po.error);
    post('withdraw', [
      { account: 'user:' + req.user.id, amount: -b.amountCents, userId: req.user.id },
      { account: 'card:' + req.user.id, amount: b.amountCents },
    ], { description: `Withdrawal to card •••• ${req.user.card_last4}` });
    audit({ actorId: req.user.id, action: 'wallet.withdraw', meta: { amount: b.amountCents, payout: po.payoutId }, ip: clientIp(req) });
    const out = { ok: true, payoutId: po.payoutId };
    db.prepare("INSERT INTO idempotency (user_id, key, scope, response, created_at) VALUES (?,?,'withdraw',?,?)").run(req.user.id, key, JSON.stringify(out), now());
    return out;
  });
  res.json({ ...result, user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// Чат поддержки (один тред на пользователя)
r.get('/support/messages', (req, res) => {
  const has = db.prepare("SELECT 1 FROM messages WHERE thread_type = 'support' AND thread_id = ?").get(req.user.id);
  if (!has) systemMessage('support', req.user.id, `Hi ${req.user.name}! I'm Sofia from Kelishen support. How can I help?`, 'support');
  res.json(listMessages('support', req.user.id, Number(req.query.after) || 0));
});

r.post('/support/messages', (req, res) => {
  const b = parse(zMessage, req.body);
  if (!b.text && !b.fileId) fail(400, 'Empty message');
  if (b.fileId && !db.prepare("SELECT 1 FROM files WHERE id = ? AND owner_id = ? AND purpose = 'support'").get(b.fileId, req.user.id)) fail(400, 'File not found');
  db.prepare(`INSERT INTO messages (thread_type, thread_id, sender_id, sender_role, text, file_id, created_at) VALUES ('support',?,?,'user',?,?,?)`)
    .run(req.user.id, req.user.id, b.text, b.fileId ?? null, now());
  // Автоответ, если оператор ещё не отвечал в последние 10 минут
  const lastAgent = db.prepare("SELECT created_at FROM messages WHERE thread_type='support' AND thread_id=? AND sender_role IN ('admin','support') ORDER BY id DESC LIMIT 1").get(req.user.id);
  if (!lastAgent || Date.now() - Date.parse(lastAgent.created_at) > 10 * 60e3) {
    systemMessage('support', req.user.id, 'Thanks! We have received your request — an agent will reply within a few minutes. If it is about a specific deal, open a dispute on the deal page and your funds will stay protected.', 'support');
  }
  for (const a of db.prepare("SELECT id FROM users WHERE role='admin'").all()) notify(a.id, `Support message from ${req.user.name}`, '/admin');
  res.status(201).json({ ok: true });
});

export default r;
