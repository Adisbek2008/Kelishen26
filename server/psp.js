/**
 * Мок платёжного провайдера (PSP). В production здесь интеграция с реальным эквайрингом
 * (hosted fields / 3-D Secure), и номер карты вообще не попадает на наш сервер.
 * Сейчас: PAN проверяется и сразу отбрасывается — в БД хранится только токен, last4 и бренд.
 */
import { randomToken } from './crypto.js';

export function luhn(num) {
  let sum = 0, dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

function brand(num) {
  if (/^4/.test(num)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard';
  if (/^220[0-4]/.test(num)) return 'MIR';
  if (/^9417/.test(num)) return 'Elcard';
  return 'Card';
}

export function tokenizeCard({ number, exp, cvc }) {
  const pan = String(number).replace(/\s+/g, '');
  if (!/^\d{13,19}$/.test(pan) || !luhn(pan)) return { ok: false, error: 'Неверный номер карты' };
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(exp));
  if (!m) return { ok: false, error: 'Срок действия в формате MM/YY' };
  const mm = Number(m[1]), yy = 2000 + Number(m[2]);
  const end = new Date(yy, mm, 1);
  if (mm < 1 || mm > 12 || end <= new Date()) return { ok: false, error: 'Срок действия карты истёк' };
  if (!/^\d{3,4}$/.test(String(cvc))) return { ok: false, error: 'Неверный CVV' };
  // CVV используется только для авторизации у PSP и нигде не сохраняется
  // Тестовая карта 4000 0000 0000 0002 — PSP выдаёт токен, по которому все списания отклоняются
  const prefix = pan === '4000000000000002' ? 'tok_decline_' : 'tok_';
  return { ok: true, token: prefix + randomToken(18), last4: pan.slice(-4), brand: brand(pan), exp: `${m[1]}/${m[2]}` };
}

export function charge(token, amountCents) {
  if (!token) return { ok: false, error: 'Карта не привязана' };
  if (token.startsWith('tok_decline_')) return { ok: false, error: 'Платёж отклонён банком' };
  return { ok: true, chargeId: 'ch_' + randomToken(12), amountCents };
}

export function payout(token, amountCents) {
  if (!token) return { ok: false, error: 'Карта не привязана' };
  return { ok: true, payoutId: 'po_' + randomToken(12), amountCents };
}
