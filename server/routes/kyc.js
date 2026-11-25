import { Router } from 'express';
import { db, now, tx } from '../db.js';
import { config } from '../config.js';
import { encryptPII, decryptPII } from '../crypto.js';
import { audit } from '../audit.js';
import * as psp from '../psp.js';
import { parse, fail, z, clientIp } from '../http.js';
import { requireAuth } from '../auth.js';
import { notify } from '../services.js';
import { me } from './auth.js';

const mask = (s) => (s ? s.slice(0, 2) + '•'.repeat(Math.max(0, s.length - 4)) + s.slice(-2) : null);
const zCard = z.object({
  number: z.string().max(23),
  exp: z.string().max(7),
  cvc: z.string().max(4),
}).strict();

// Автоодобрение: по умолчанию включено в dev и выключено в production.
// Явное KYC_AUTO_APPROVE=1 / 0 переопределяет (для публичного демо без реальных проверок).
const AUTO_APPROVE = process.env.KYC_AUTO_APPROVE ? process.env.KYC_AUTO_APPROVE === '1' : !config.isProd;

const r = Router();
r.use(requireAuth);

r.get('/', (req, res) => {
  const u = req.user;
  res.json({
    status: u.kyc_status, note: u.kyc_note,
    fullName: decryptPII(u.kyc_full_name_enc),
    passportMasked: mask(decryptPII(u.kyc_passport_enc)),
    hasPhoto: !!u.kyc_file_id,
    card: u.card_last4 ? { brand: u.card_brand, last4: u.card_last4, exp: u.card_exp } : null,
  });
});

r.post('/', (req, res) => {
  const b = parse(z.object({
    fullName: z.string().trim().min(5).max(120).regex(/^[\p{L} .'-]+$/u, 'только буквы'),
    passportNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,12}$/, '6–12 латинских букв/цифр'),
    fileId: z.uuid(),
    card: zCard,
  }), req.body);
  if (['pending', 'verified'].includes(req.user.kyc_status)) fail(409, 'Заявка уже подана');
  const f = db.prepare("SELECT 1 FROM files WHERE id = ? AND owner_id = ? AND purpose = 'kyc'").get(b.fileId, req.user.id);
  if (!f) fail(400, 'Загрузите фото паспорта');
  const card = psp.tokenizeCard(b.card);
  if (!card.ok) fail(400, card.error, 'card_invalid');
  const status = AUTO_APPROVE ? 'verified' : 'pending';
  tx(() => {
    db.prepare(`UPDATE users SET kyc_status = ?, kyc_full_name_enc = ?, kyc_passport_enc = ?, kyc_file_id = ?, kyc_note = NULL,
                card_token = ?, card_last4 = ?, card_brand = ?, card_exp = ? WHERE id = ?`)
      .run(status, encryptPII(b.fullName), encryptPII(b.passportNumber), b.fileId, card.token, card.last4, card.brand, card.exp, req.user.id);
    audit({ actorId: req.user.id, action: 'kyc.submit', entity: 'user', entityId: req.user.id, meta: { auto: AUTO_APPROVE, card: card.last4 }, ip: clientIp(req) });
    if (AUTO_APPROVE) notify(req.user.id, 'Личность подтверждена. Теперь вам доступны все функции', '/profile');
    else for (const a of db.prepare("SELECT id FROM users WHERE role='admin'").all()) notify(a.id, `Новая заявка на верификацию: ${req.user.name}`, '/admin');
  });
  res.json({ user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

r.put('/card', (req, res) => {
  const b = parse(z.object({ card: zCard }), req.body);
  const card = psp.tokenizeCard(b.card);
  if (!card.ok) fail(400, card.error, 'card_invalid');
  db.prepare('UPDATE users SET card_token = ?, card_last4 = ?, card_brand = ?, card_exp = ? WHERE id = ?')
    .run(card.token, card.last4, card.brand, card.exp, req.user.id);
  audit({ actorId: req.user.id, action: 'card.replace', entity: 'user', entityId: req.user.id, meta: { last4: card.last4 }, ip: clientIp(req) });
  res.json({ user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

export default r;
