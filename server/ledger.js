import { db, now } from './db.js';
import { uuid } from './crypto.js';

/**
 * Счета:
 *   card:<userId>   — внешний источник/получатель (карта пользователя у PSP)
 *   escrow:<dealId> — зарезервированные средства сделки
 *   user:<userId>   — доступный баланс продавца (к выводу)
 *   platform:fees   — доход платформы
 */
export function post(kind, entries, { dealId = null, description = '' } = {}) {
  const sum = entries.reduce((s, e) => s + e.amount, 0);
  if (sum !== 0) throw new Error(`Unbalanced ledger tx (${sum})`);
  if (entries.some((e) => !Number.isSafeInteger(e.amount))) throw new Error('Non-integer amount');
  const txId = uuid();
  const at = now();
  const ins = db.prepare(`INSERT INTO ledger (tx_id, kind, account, amount_cents, deal_id, user_id, description, created_at)
                          VALUES (?,?,?,?,?,?,?,?)`);
  for (const e of entries) {
    if (e.amount === 0) continue;
    ins.run(txId, kind, e.account, e.amount, dealId, e.userId ?? null, description, at);
  }
  return txId;
}

export const balance = (account) =>
  db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS b FROM ledger WHERE account = ?').get(account).b;

/** Инвариант: сумма всех проводок = 0, ни один escrow/user счёт не уходит в минус. */
export function checkInvariants() {
  const total = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM ledger').get().s;
  const negative = db.prepare(`SELECT account, SUM(amount_cents) AS b FROM ledger
     WHERE account LIKE 'escrow:%' OR account LIKE 'user:%' OR account = 'platform:fees'
     GROUP BY account HAVING b < 0`).all();
  return { ok: total === 0 && negative.length === 0, total, negative };
}
