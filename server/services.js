import { db, now } from './db.js';
import { config } from './config.js';

export function notify(userId, text, link = null) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id, text, link, created_at) VALUES (?,?,?,?)').run(userId, text, link, now());
}

export function dealEvent(dealId, actorId, type, text) {
  db.prepare('INSERT INTO deal_events (deal_id, actor_id, type, text, created_at) VALUES (?,?,?,?,?)').run(dealId, actorId, type, text, now());
}

export function systemMessage(threadType, threadId, text, senderRole = 'system') {
  db.prepare(`INSERT INTO messages (thread_type, thread_id, sender_id, sender_role, text, created_at)
              VALUES (?,?,NULL,?,?,?)`).run(threadType, threadId, senderRole, text, now());
}

export function userStats(userId) {
  const r = db.prepare('SELECT ROUND(AVG(rating),1) AS rating, COUNT(*) AS reviews FROM reviews WHERE target_id = ?').get(userId);
  const c = db.prepare(`SELECT COUNT(*) AS n FROM deals WHERE (buyer_id = ? OR seller_id = ?) AND status IN ('completed','resolved')`).get(userId, userId);
  return { rating: r.rating ?? null, reviews: r.reviews, completedDeals: c.n };
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, verified: u.kyc_status === 'verified', memberSince: u.created_at, ...userStats(u.id) };
}

/** Комиссия: 2% (мин. $1), делится согласно fee_payer. Возвращает суммы в центах. */
export function feeSplit(amountCents, feePayer) {
  const fee = Math.max(config.minFeeCents, Math.round(amountCents * config.feeRate));
  const buyerFee = feePayer === 'buyer' ? fee : feePayer === 'split' ? Math.ceil(fee / 2) : 0;
  const sellerFee = fee - buyerFee;
  return { fee, buyerFee, sellerFee, buyerPays: amountCents + buyerFee, sellerGets: amountCents - sellerFee };
}

export function nextDealCode() {
  for (;;) {
    const code = 'SH-' + (1000 + Math.floor(Math.random() * 9000));
    if (!db.prepare('SELECT 1 FROM deals WHERE code = ?').get(code)) return code;
  }
}
