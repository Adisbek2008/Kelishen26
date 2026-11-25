import { Router } from 'express';
import { db, now, tx } from '../db.js';
import { decryptPII } from '../crypto.js';
import { audit, verifyAuditChain } from '../audit.js';
import { post, balance, checkInvariants } from '../ledger.js';
import { parse, fail, z, clientIp } from '../http.js';
import { requireAdmin } from '../auth.js';
import { notify, dealEvent, systemMessage, publicUser } from '../services.js';
import { dealView, releaseFunds, refundBuyer, listMessages, zMessage } from './deals.js';

const r = Router();
r.use(requireAdmin);

r.get('/overview', (req, res) => {
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM deals GROUP BY status').all().map((x) => [x.status, x.n]));
  const escrow = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM ledger WHERE account LIKE 'escrow:%'").get().s;
  res.json({
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    deals: counts,
    escrowCents: escrow,
    feesCents: balance('platform:fees'),
    ledger: checkInvariants(),
    audit: verifyAuditChain(),
  });
});

r.get('/disputes', (req, res) => {
  const rows = db.prepare("SELECT * FROM deals WHERE status = 'disputed' ORDER BY updated_at").all();
  res.json(rows.map((d) => dealView(d, req.user, { full: true })));
});

r.post('/deals/:id/resolve', (req, res) => {
  const b = parse(z.object({
    decision: z.enum(['seller', 'buyer', 'split']),
    buyerPercent: z.number().int().min(1).max(99).optional(),
    comment: z.string().trim().min(5).max(2000),
  }), req.body);
  if (b.decision === 'split' && !b.buyerPercent) fail(400, 'Укажите долю покупателя');
  tx(() => {
    const d = db.prepare('SELECT * FROM deals WHERE id = ?').get(String(req.params.id));
    if (!d || d.status !== 'disputed') fail(409, 'Сделка не в статусе спора');
    const held = balance('escrow:' + d.id);
    let resolution;
    if (b.decision === 'seller') {
      releaseFunds(d, req.user.id, 'Спор решён в пользу продавца');
      resolution = { decision: 'seller' };
    } else if (b.decision === 'buyer') {
      refundBuyer(d, req.user.id, 'Спор решён в пользу покупателя');
      resolution = { decision: 'buyer', buyerCents: held, sellerCents: 0 };
    } else {
      const buyerCents = Math.round((held * b.buyerPercent) / 100);
      const sellerCents = held - buyerCents;
      post('split', [
        { account: 'escrow:' + d.id, amount: -held },
        { account: 'card:' + d.buyer_id, amount: buyerCents, userId: d.buyer_id },
        { account: 'user:' + d.seller_id, amount: sellerCents, userId: d.seller_id },
      ], { dealId: d.id, description: `Распределение по спору ${d.code}` });
      dealEvent(d.id, req.user.id, 'split', `Средства распределены: покупателю ${b.buyerPercent}%, продавцу ${100 - b.buyerPercent}%`);
      systemMessage('deal', d.id, `⚖️ Спор решён: покупателю возвращено ${b.buyerPercent}%, продавцу перечислено ${100 - b.buyerPercent}%.`);
      notify(d.buyer_id, `Спор по сделке ${d.code} решён`, `/deals/${d.id}`);
      notify(d.seller_id, `Спор по сделке ${d.code} решён`, `/deals/${d.id}`);
      resolution = { decision: 'split', buyerPercent: b.buyerPercent, buyerCents, sellerCents };
    }
    resolution = { ...resolution, comment: b.comment, at: now() };
    const status = b.decision === 'buyer' ? 'refunded' : 'resolved';
    const upd = db.prepare("UPDATE deals SET status = ?, resolution = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'disputed'")
      .run(status, JSON.stringify(resolution), now(), d.id);
    if (upd.changes !== 1) fail(409, 'Конфликт статуса');
    systemMessage('deal', d.id, `Комментарий администрации: ${b.comment}`, 'admin');
    audit({ actorId: req.user.id, action: 'admin.dispute_resolve', entity: 'deal', entityId: d.id, meta: resolution, ip: clientIp(req) });
  });
  res.json({ ok: true });
});

r.get('/kyc', (req, res) => {
  res.json(db.prepare("SELECT id, name, email, kyc_status AS status, created_at AS createdAt FROM users WHERE kyc_status = 'pending' ORDER BY created_at").all());
});

// Просмотр персональных данных — только админ, каждое обращение пишется в аудит
r.get('/kyc/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(String(req.params.id));
  if (!u) fail(404, 'Не найдено');
  audit({ actorId: req.user.id, action: 'pii.kyc_viewed', entity: 'user', entityId: u.id, ip: clientIp(req) });
  res.json({ id: u.id, name: u.name, email: u.email, status: u.kyc_status, fullName: decryptPII(u.kyc_full_name_enc),
    passportNumber: decryptPII(u.kyc_passport_enc), fileId: u.kyc_file_id, card: u.card_last4 ? `${u.card_brand} •••• ${u.card_last4}` : null });
});

r.post('/kyc/:id', (req, res) => {
  const b = parse(z.object({ decision: z.enum(['verified', 'rejected']), note: z.string().trim().max(500).optional() }), req.body);
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND kyc_status = 'pending'").get(String(req.params.id));
  if (!u) fail(404, 'Заявка не найдена');
  db.prepare('UPDATE users SET kyc_status = ?, kyc_note = ? WHERE id = ?').run(b.decision, b.note ?? null, u.id);
  notify(u.id, b.decision === 'verified' ? 'Личность подтверждена' : `Верификация отклонена${b.note ? ': ' + b.note : ''}`, '/profile');
  audit({ actorId: req.user.id, action: 'admin.kyc_' + b.decision, entity: 'user', entityId: u.id, ip: clientIp(req) });
  res.json({ ok: true });
});

r.get('/support', (req, res) => {
  const rows = db.prepare(`SELECT m.thread_id AS userId, m.id AS lastId, u.name, u.email, m.text AS lastText, m.sender_role AS lastRole
    FROM messages m JOIN users u ON u.id = m.thread_id
    WHERE m.thread_type = 'support'
      AND m.id = (SELECT MAX(id) FROM messages WHERE thread_type = 'support' AND thread_id = m.thread_id)
    ORDER BY m.id DESC`).all();
  res.json(rows.map((x) => ({ ...x, needsReply: x.lastRole === 'user' || x.lastRole === 'support' })));
});
r.get('/support/:userId', (req, res) => {
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(String(req.params.userId))), messages: listMessages('support', String(req.params.userId)) });
});
r.post('/support/:userId', (req, res) => {
  const b = parse(zMessage, req.body);
  if (!b.text) fail(400, 'Пустое сообщение');
  const uid = String(req.params.userId);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) fail(404, 'Не найдено');
  db.prepare(`INSERT INTO messages (thread_type, thread_id, sender_id, sender_role, text, created_at) VALUES ('support',?,?,'admin',?,?)`).run(uid, req.user.id, b.text, now());
  notify(uid, 'Ответ службы поддержки', '/support');
  res.json({ ok: true });
});

r.get('/audit', (req, res) => {
  res.json(db.prepare(`SELECT a.id, a.at, a.action, a.entity, a.entity_id AS entityId, a.meta, a.ip, a.hash, u.email AS actor
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200`).all());
});

export default r;
