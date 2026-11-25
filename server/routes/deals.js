import { Router } from 'express';
import { db, now, tx } from '../db.js';
import { config } from '../config.js';
import { uuid, randomToken } from '../crypto.js';
import { audit } from '../audit.js';
import { post, balance } from '../ledger.js';
import * as psp from '../psp.js';
import { parse, fail, z, clientIp } from '../http.js';
import { requireAuth, requireVerified } from '../auth.js';
import { notify, dealEvent, systemMessage, publicUser, feeSplit, nextDealCode } from '../services.js';
import { fileView } from './files.js';

export const ACTIVE = ['pending_partner', 'awaiting_payment', 'funds_reserved', 'delivered', 'disputed'];
const getUser = (id) => (id ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null);
const getDeal = (id) => db.prepare('SELECT * FROM deals WHERE id = ?').get(String(id));

export function roleOf(d, userId) {
  if (d.buyer_id === userId) return 'buyer';
  if (d.seller_id === userId) return 'seller';
  return null;
}

/** Действия, разрешённые пользователю в текущем статусе (единый источник правды для UI и API). */
export function allowedActions(d, user) {
  const role = roleOf(d, user.id);
  const a = [];
  if (user.role === 'admin' && d.status === 'disputed') a.push('resolve');
  if (!role) return a;
  switch (d.status) {
    case 'pending_partner': if (d.creator_id === user.id) a.push('cancel'); break;
    case 'awaiting_payment': if (role === 'buyer') a.push('pay'); a.push('cancel'); break;
    case 'funds_reserved':
      if (role === 'seller') a.push('deliver', 'refund');
      if (role === 'buyer') a.push('confirm');
      a.push('dispute'); break;
    case 'delivered':
      if (role === 'buyer') a.push('confirm');
      if (role === 'seller') a.push('refund');
      a.push('dispute'); break;
    case 'completed': case 'resolved': case 'refunded': {
      const other = role === 'buyer' ? d.seller_id : d.buyer_id;
      const done = db.prepare('SELECT 1 FROM reviews WHERE deal_id = ? AND author_id = ?').get(d.id, user.id);
      if (other && !done) a.push('review');
      break;
    }
  }
  return a;
}

export function dealView(d, user, { full = false } = {}) {
  const role = roleOf(d, user.id);
  const counterpartyId = role === 'buyer' ? d.seller_id : role === 'seller' ? d.buyer_id : null;
  const v = {
    id: d.id, code: d.code, title: d.title, category: d.category, status: d.status,
    amountCents: d.amount_cents, feePayer: d.fee_payer, ...feeSplit(d.amount_cents, d.fee_payer),
    myRole: role, isCreator: d.creator_id === user.id,
    counterparty: publicUser(getUser(counterpartyId)),
    createdAt: d.created_at, updatedAt: d.updated_at,
  };
  if (!full) return v;
  return {
    ...v,
    description: d.description, conditions: d.conditions, deadline: d.deadline,
    buyer: publicUser(getUser(d.buyer_id)), seller: publicUser(getUser(d.seller_id)),
    inviteUrl: d.status === 'pending_partner' && d.creator_id === user.id && d.invite_token ? `${config.publicUrl}/invite/${d.invite_token}` : null,
    escrowCents: balance('escrow:' + d.id),
    deliveredAt: d.delivered_at,
    autoReleaseAt: d.delivered_at ? new Date(Date.parse(d.delivered_at) + config.autoReleaseDays * 864e5).toISOString() : null,
    resolution: d.resolution ? JSON.parse(d.resolution) : null,
    actions: allowedActions(d, user),
    events: db.prepare('SELECT type, text, created_at AS at FROM deal_events WHERE deal_id = ? ORDER BY id').all(d.id),
  };
}

/** Доступ к сделке — только участникам и администратору (защита от IDOR). 404 вместо 403, чтобы не раскрывать существование. */
function loadForUser(req) {
  const d = getDeal(req.params.id);
  if (!d || (!roleOf(d, req.user.id) && req.user.role !== 'admin')) fail(404, 'Сделка не найдена');
  return d;
}

/** Атомарный переход статуса с проверкой ожидаемого состояния (оптимистическая блокировка). */
function transition(d, from, to, extra = {}) {
  const sets = ['status = ?', 'updated_at = ?', 'version = version + 1', ...Object.keys(extra).map((k) => `${k} = ?`)];
  const res = db.prepare(`UPDATE deals SET ${sets.join(', ')} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`)
    .run(to, now(), ...Object.values(extra), d.id, ...from);
  if (res.changes !== 1) fail(409, 'Статус сделки изменился, обновите страницу', 'conflict');
}

function requireAction(d, user, action) {
  if (!allowedActions(d, user).includes(action)) fail(409, 'Действие недоступно в текущем статусе сделки', 'bad_state');
}

/** Идемпотентность денежных операций: повтор с тем же ключом вернёт сохранённый ответ, а не спишет деньги дважды. */
function idempotent(req, scope, fn) {
  const key = String(req.get('idempotency-key') || '');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) fail(400, 'Нужен заголовок Idempotency-Key');
  return tx(() => {
    const prev = db.prepare('SELECT response FROM idempotency WHERE user_id = ? AND key = ? AND scope = ?').get(req.user.id, key, scope);
    if (prev) return JSON.parse(prev.response);
    const result = fn();
    db.prepare('INSERT INTO idempotency (user_id, key, scope, response, created_at) VALUES (?,?,?,?,?)').run(req.user.id, key, scope, JSON.stringify(result), now());
    return result;
  });
}

/** Выплата продавцу по успешной сделке. Вызывается внутри tx. */
export function releaseFunds(d, actorId, reason) {
  const held = balance('escrow:' + d.id);
  const f = feeSplit(d.amount_cents, d.fee_payer);
  if (held !== f.buyerPays) throw new Error(`Escrow mismatch for ${d.code}: ${held} != ${f.buyerPays}`);
  post('release', [
    { account: 'escrow:' + d.id, amount: -held },
    { account: 'user:' + d.seller_id, amount: f.sellerGets, userId: d.seller_id },
    { account: 'platform:fees', amount: f.fee },
  ], { dealId: d.id, description: `Выплата по сделке ${d.code}` });
  dealEvent(d.id, actorId, 'released', `${reason}. Средства перечислены продавцу`);
  systemMessage('deal', d.id, `✅ ${reason}. Средства перечислены продавцу.`);
  notify(d.seller_id, `Средства по сделке ${d.code} перечислены на ваш баланс`, `/deals/${d.id}`);
  notify(d.buyer_id, `Сделка ${d.code} завершена`, `/deals/${d.id}`);
}

export function refundBuyer(d, actorId, reason) {
  const held = balance('escrow:' + d.id);
  post('refund', [
    { account: 'escrow:' + d.id, amount: -held },
    { account: 'card:' + d.buyer_id, amount: held, userId: d.buyer_id },
  ], { dealId: d.id, description: `Возврат по сделке ${d.code}` });
  dealEvent(d.id, actorId, 'refunded', `${reason}. Средства возвращены покупателю`);
  systemMessage('deal', d.id, `↩️ ${reason}. Средства возвращены покупателю.`);
  notify(d.buyer_id, `Средства по сделке ${d.code} возвращены на вашу карту`, `/deals/${d.id}`);
  notify(d.seller_id, `По сделке ${d.code} оформлен возврат покупателю`, `/deals/${d.id}`);
}

const r = Router();
r.use(requireAuth);

r.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
  const rows = db.prepare('SELECT * FROM deals WHERE buyer_id = ? OR seller_id = ? OR creator_id = ? ORDER BY updated_at DESC').all(req.user.id, req.user.id, req.user.id);
  let list = rows.map((d) => dealView(d, req.user));
  if (q) list = list.filter((d) => d.title.toLowerCase().includes(q) || d.code.toLowerCase().includes(q) || d.counterparty?.name.toLowerCase().includes(q));
  res.json(list);
});

r.post('/', (req, res) => {
  const b = parse(z.object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(2000).default(''),
    category: z.enum(['goods', 'service', 'rent']),
    conditions: z.string().trim().max(2000).default(''),
    amountCents: z.number().int().min(500, 'минимум $5').max(config.maxDealCents),
    myRole: z.enum(['buyer', 'seller']),
    feePayer: z.enum(['buyer', 'seller', 'split']).default('split'),
    deadline: z.iso.date().optional(),
  }), req.body);
  const id = uuid();
  const d = {
    id, code: nextDealCode(), title: b.title, description: b.description, category: b.category, conditions: b.conditions,
    amount_cents: b.amountCents, fee_cents: feeSplit(b.amountCents, b.feePayer).fee, fee_payer: b.feePayer, creator_id: req.user.id,
    buyer_id: b.myRole === 'buyer' ? req.user.id : null, seller_id: b.myRole === 'seller' ? req.user.id : null,
    status: 'pending_partner', invite_token: randomToken(24), deadline: b.deadline ?? null, created_at: now(), updated_at: now(),
  };
  tx(() => {
    db.prepare(`INSERT INTO deals (id, code, title, description, category, conditions, amount_cents, fee_cents, fee_payer, creator_id,
                buyer_id, seller_id, status, invite_token, deadline, created_at, updated_at)
                VALUES (:id,:code,:title,:description,:category,:conditions,:amount_cents,:fee_cents,:fee_payer,:creator_id,
                :buyer_id,:seller_id,:status,:invite_token,:deadline,:created_at,:updated_at)`).run(d);
    dealEvent(id, req.user.id, 'created', `Сделка создана, вы — ${b.myRole === 'buyer' ? 'покупатель' : 'продавец'}`);
    systemMessage('deal', id, 'Сделка создана. Отправьте ссылку-приглашение второй стороне.');
    audit({ actorId: req.user.id, action: 'deal.create', entity: 'deal', entityId: id, meta: { amount: b.amountCents }, ip: clientIp(req) });
  });
  res.status(201).json(dealView(getDeal(id), req.user, { full: true }));
});

r.get('/:id', (req, res) => res.json(dealView(loadForUser(req), req.user, { full: true })));

r.post('/:id/pay', (req, res) => {
  requireVerified(req);
  const result = idempotent(req, 'pay:' + req.params.id, () => {
    const d = loadForUser(req);
    requireAction(d, req.user, 'pay');
    const f = feeSplit(d.amount_cents, d.fee_payer);
    const ch = psp.charge(req.user.card_token, f.buyerPays);
    if (!ch.ok) fail(402, ch.error, 'payment_failed');
    post('hold', [
      { account: 'card:' + req.user.id, amount: -f.buyerPays, userId: req.user.id },
      { account: 'escrow:' + d.id, amount: f.buyerPays },
    ], { dealId: d.id, description: `Оплата сделки ${d.code} (резерв)` });
    transition(d, ['awaiting_payment'], 'funds_reserved');
    dealEvent(d.id, req.user.id, 'paid', `Покупатель оплатил ${(f.buyerPays / 100).toFixed(2)} — средства зарезервированы`);
    systemMessage('deal', d.id, '🔒 Средства зарезервированы. Продавец может передавать товар или оказывать услугу.');
    notify(d.seller_id, `Покупатель оплатил сделку ${d.code}. Средства зарезервированы`, `/deals/${d.id}`);
    audit({ actorId: req.user.id, action: 'deal.pay', entity: 'deal', entityId: d.id, meta: { amount: f.buyerPays, charge: ch.chargeId }, ip: clientIp(req) });
    return { ok: true };
  });
  res.json({ ...result, deal: dealView(getDeal(req.params.id), req.user, { full: true }) });
});

r.post('/:id/deliver', (req, res) => {
  const b = parse(z.object({ note: z.string().trim().max(1000).default('') }), req.body);
  tx(() => {
    const d = loadForUser(req);
    requireAction(d, req.user, 'deliver');
    transition(d, ['funds_reserved'], 'delivered', { delivered_at: now() });
    dealEvent(d.id, req.user.id, 'delivered', 'Продавец отметил: товар передан / услуга оказана');
    systemMessage('deal', d.id, `📦 Продавец отметил выполнение.${b.note ? ' Комментарий: ' + b.note : ''} Покупатель, проверьте и подтвердите сделку. Без ответа средства будут перечислены автоматически через ${config.autoReleaseDays} дн.`);
    notify(d.buyer_id, `Продавец выполнил условия сделки ${d.code}. Подтвердите получение`, `/deals/${d.id}`);
    audit({ actorId: req.user.id, action: 'deal.deliver', entity: 'deal', entityId: d.id, ip: clientIp(req) });
  });
  res.json(dealView(getDeal(req.params.id), req.user, { full: true }));
});

r.post('/:id/confirm', (req, res) => {
  tx(() => {
    const d = loadForUser(req);
    requireAction(d, req.user, 'confirm');
    transition(d, ['funds_reserved', 'delivered'], 'completed');
    releaseFunds(d, req.user.id, 'Покупатель подтвердил выполнение сделки');
    audit({ actorId: req.user.id, action: 'deal.confirm', entity: 'deal', entityId: d.id, ip: clientIp(req) });
  });
  res.json(dealView(getDeal(req.params.id), req.user, { full: true }));
});

r.post('/:id/refund', (req, res) => {
  tx(() => {
    const d = loadForUser(req);
    requireAction(d, req.user, 'refund');
    transition(d, ['funds_reserved', 'delivered'], 'refunded');
    refundBuyer(d, req.user.id, 'Продавец отменил сделку');
    audit({ actorId: req.user.id, action: 'deal.refund_by_seller', entity: 'deal', entityId: d.id, ip: clientIp(req) });
  });
  res.json(dealView(getDeal(req.params.id), req.user, { full: true }));
});

r.post('/:id/cancel', (req, res) => {
  tx(() => {
    const d = loadForUser(req);
    requireAction(d, req.user, 'cancel');
    transition(d, ['pending_partner', 'awaiting_payment'], 'cancelled', { invite_token: null });
    dealEvent(d.id, req.user.id, 'cancelled', 'Сделка отменена до оплаты');
    systemMessage('deal', d.id, 'Сделка отменена.');
    const other = roleOf(d, req.user.id) === 'buyer' ? d.seller_id : d.buyer_id;
    notify(other, `Сделка ${d.code} отменена`, `/deals/${d.id}`);
    audit({ actorId: req.user.id, action: 'deal.cancel', entity: 'deal', entityId: d.id, ip: clientIp(req) });
  });
  res.json(dealView(getDeal(req.params.id), req.user, { full: true }));
});

r.post('/:id/dispute', (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(10, 'опишите проблему подробнее').max(2000), fileId: z.uuid().optional() }), req.body);
  tx(() => {
    const d = loadForUser(req);
    requireAction(d, req.user, 'dispute');
    if (b.fileId) {
      const f = db.prepare("SELECT * FROM files WHERE id = ? AND owner_id = ? AND purpose = 'deal' AND deal_id = ?").get(b.fileId, req.user.id, d.id);
      if (!f) fail(400, 'Файл не найден');
    }
    transition(d, ['funds_reserved', 'delivered'], 'disputed');
    const who = roleOf(d, req.user.id) === 'buyer' ? 'Покупатель' : 'Продавец';
    dealEvent(d.id, req.user.id, 'disputed', `${who} открыл спор`);
    db.prepare(`INSERT INTO messages (thread_type, thread_id, sender_id, sender_role, text, file_id, created_at)
                VALUES ('deal', ?, ?, 'user', ?, ?, ?)`).run(d.id, req.user.id, `⚠️ Открыт спор: ${b.reason}`, b.fileId ?? null, now());
    systemMessage('deal', d.id, 'Средства заморожены до решения администрации. Приложите доказательства (фото, документы, переписку) в этот чат.');
    const other = roleOf(d, req.user.id) === 'buyer' ? d.seller_id : d.buyer_id;
    notify(other, `По сделке ${d.code} открыт спор`, `/deals/${d.id}`);
    for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin'").all()) notify(a.id, `Новый спор: ${d.code}`, `/admin`);
    audit({ actorId: req.user.id, action: 'deal.dispute', entity: 'deal', entityId: d.id, ip: clientIp(req) });
  });
  res.json(dealView(getDeal(req.params.id), req.user, { full: true }));
});

r.post('/:id/review', (req, res) => {
  const b = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).default('') }), req.body);
  tx(() => {
    const d = loadForUser(req);
    requireAction(d, req.user, 'review');
    const target = roleOf(d, req.user.id) === 'buyer' ? d.seller_id : d.buyer_id;
    db.prepare('INSERT INTO reviews (deal_id, author_id, target_id, rating, comment, created_at) VALUES (?,?,?,?,?,?)')
      .run(d.id, req.user.id, target, b.rating, b.comment, now());
    notify(target, `Вы получили отзыв ${'★'.repeat(b.rating)} по сделке ${d.code}`, `/users/${target}`);
  });
  res.json(dealView(getDeal(req.params.id), req.user, { full: true }));
});

// ---------- Сообщения сделки ----------
const msgView = (m) => ({
  id: m.id, text: m.text, senderId: m.sender_id, senderRole: m.sender_role, senderName: m.sender_name ?? null,
  file: fileView(m.file_id ? db.prepare('SELECT * FROM files WHERE id = ?').get(m.file_id) : null), at: m.created_at,
});
export const listMessages = (type, threadId, after = 0) =>
  db.prepare(`SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id
              WHERE thread_type = ? AND thread_id = ? AND m.id > ? ORDER BY m.id LIMIT 500`).all(type, threadId, after).map(msgView);

export const zMessage = z.object({ text: z.string().trim().max(4000).default(''), fileId: z.uuid().optional() });

r.get('/:id/messages', (req, res) => {
  const d = loadForUser(req);
  res.json(listMessages('deal', d.id, Number(req.query.after) || 0));
});

r.post('/:id/messages', (req, res) => {
  const d = loadForUser(req);
  const b = parse(zMessage, req.body);
  if (!b.text && !b.fileId) fail(400, 'Пустое сообщение');
  if (['cancelled'].includes(d.status)) fail(409, 'Сделка закрыта');
  if (b.fileId && !db.prepare("SELECT 1 FROM files WHERE id = ? AND owner_id = ? AND purpose = 'deal' AND deal_id = ?").get(b.fileId, req.user.id, d.id)) fail(400, 'Файл не найден');
  const role = req.user.role === 'admin' && !roleOf(d, req.user.id) ? 'admin' : 'user';
  db.prepare(`INSERT INTO messages (thread_type, thread_id, sender_id, sender_role, text, file_id, created_at) VALUES ('deal',?,?,?,?,?,?)`)
    .run(d.id, req.user.id, role, b.text, b.fileId ?? null, now());
  const other = roleOf(d, req.user.id) === 'buyer' ? d.seller_id : d.buyer_id;
  notify(other, `Новое сообщение по сделке ${d.code}`, `/deals/${d.id}`);
  res.status(201).json({ ok: true });
});

// ---------- Приглашения ----------
export const invites = Router();

invites.get('/:token', (req, res) => {
  const d = db.prepare("SELECT * FROM deals WHERE invite_token = ? AND status = 'pending_partner'").get(String(req.params.token));
  if (!d) fail(404, 'Приглашение недействительно или уже использовано');
  const creator = getUser(d.creator_id);
  res.json({
    code: d.code, title: d.title, description: d.description, category: d.category, conditions: d.conditions,
    amountCents: d.amount_cents, feePayer: d.fee_payer, ...feeSplit(d.amount_cents, d.fee_payer), deadline: d.deadline,
    creator: publicUser(creator), creatorRole: d.buyer_id ? 'buyer' : 'seller',
  });
});

invites.post('/:token/accept', requireAuth, (req, res) => {
  const id = tx(() => {
    const d = db.prepare("SELECT * FROM deals WHERE invite_token = ? AND status = 'pending_partner'").get(String(req.params.token));
    if (!d) fail(404, 'Приглашение недействительно или уже использовано');
    if (d.creator_id === req.user.id) fail(400, 'Нельзя принять собственное приглашение');
    const col = d.buyer_id ? 'seller_id' : 'buyer_id';
    // Ссылка одноразовая: токен удаляется при принятии
    transition(d, ['pending_partner'], 'awaiting_payment', { [col]: req.user.id, invite_token: null });
    dealEvent(d.id, req.user.id, 'accepted', `${req.user.name} присоединился к сделке`);
    systemMessage('deal', d.id, `${req.user.name} принял приглашение. Ожидается оплата от покупателя.`);
    notify(d.creator_id, `${req.user.name} принял приглашение в сделку ${d.code}`, `/deals/${d.id}`);
    audit({ actorId: req.user.id, action: 'deal.accept_invite', entity: 'deal', entityId: d.id, ip: clientIp(req) });
    return d.id;
  });
  res.json(dealView(getDeal(id), req.user, { full: true }));
});

export default r;
