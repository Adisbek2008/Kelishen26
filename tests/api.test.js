import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safedeal-test-'));
process.env.DATA_DIR = dir;
process.env.KYC_AUTO_APPROVE = '1';
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { checkInvariants } = await import('../server/ledger.js');
const { verifyAuditChain } = await import('../server/audit.js');

let server, base;
before(async () => { server = createApp().listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '', csrf = '';
  const call = async (method, url, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const res = await fetch(base + url, {
      method,
      headers: { 'x-requested-with': 'SafeDeal', ...(csrf && { 'x-csrf-token': csrf }), ...(cookie && { cookie }),
        'content-type': isBuf ? 'application/octet-stream' : 'application/json', ...headers },
      body: body === undefined ? undefined : isBuf ? body : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer();
    if (data?.csrfToken) csrf = data.csrfToken;
    return { status: res.status, data, headers: res.headers };
  };
  return { call, get cookie() { return cookie; }, set csrf(v) { csrf = v; } };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ff1f0003030200eea7f3b90000000049454e44ae426082', 'hex');
const key = () => 'k' + Math.random().toString(36).slice(2) + Date.now();

async function verifiedUser(name, email, card = '4242424242424242') {
  const c = client();
  assert.equal((await c.call('POST', '/api/auth/register', { name, email, password: 'Str0ngPassw0rd' })).status, 201);
  const f = await c.call('POST', '/api/files', PNG, { 'x-purpose': 'kyc', 'x-file-name': 'passport.png' });
  assert.equal(f.status, 201);
  const k = await c.call('POST', '/api/kyc', { fullName: name, passportNumber: 'ID1234567', fileId: f.data.id, card: { number: card, exp: '12/30', cvc: '123' } });
  assert.equal(k.status, 200, JSON.stringify(k.data));
  assert.equal(k.data.user.kycStatus, 'verified');
  return c;
}

test('полный цикл: создание → приглашение → оплата → доставка → подтверждение → отзыв', async () => {
  const seller = await verifiedUser('Seller One', 's1@test.io');
  const buyer = await verifiedUser('Buyer One', 'b1@test.io');
  const d = (await seller.call('POST', '/api/deals', { title: 'MacBook Pro', category: 'goods', amountCents: 100000, myRole: 'seller', feePayer: 'split' })).data;
  assert.equal(d.status, 'pending_partner');
  const token = d.inviteUrl.split('/invite/')[1];
  assert.equal((await buyer.call('GET', `/api/invite/${token}`)).status, 200);
  const acc = await buyer.call('POST', `/api/invite/${token}/accept`);
  assert.equal(acc.data.status, 'awaiting_payment');
  // ссылка одноразовая
  assert.equal((await buyer.call('GET', `/api/invite/${token}`)).status, 404);

  // без Idempotency-Key — отказ
  assert.equal((await buyer.call('POST', `/api/deals/${d.id}/pay`)).status, 400);
  const k = key();
  const p1 = await buyer.call('POST', `/api/deals/${d.id}/pay`, undefined, { 'idempotency-key': k });
  assert.equal(p1.status, 200);
  assert.equal(p1.data.deal.status, 'funds_reserved');
  assert.equal(p1.data.deal.escrowCents, 101000); // 1000 + половина комиссии 2% (20)
  // повтор того же запроса не списывает деньги второй раз
  const p2 = await buyer.call('POST', `/api/deals/${d.id}/pay`, undefined, { 'idempotency-key': k });
  assert.equal(p2.status, 200);
  assert.equal(p2.data.deal.escrowCents, 101000);

  // покупатель не может отметить доставку, продавец не может подтвердить
  assert.equal((await buyer.call('POST', `/api/deals/${d.id}/deliver`, {})).status, 409);
  assert.equal((await seller.call('POST', `/api/deals/${d.id}/confirm`)).status, 409);
  assert.equal((await seller.call('POST', `/api/deals/${d.id}/deliver`, { note: 'Отправлено' })).data.status, 'delivered');
  const done = await buyer.call('POST', `/api/deals/${d.id}/confirm`);
  assert.equal(done.data.status, 'completed');
  assert.equal(done.data.escrowCents, 0);
  const me = await seller.call('GET', '/api/auth/me');
  assert.equal(me.data.user.balanceCents, 99000);
  assert.equal((await buyer.call('POST', `/api/deals/${d.id}/review`, { rating: 5, comment: 'ok' })).status, 200);
  assert.equal((await buyer.call('POST', `/api/deals/${d.id}/review`, { rating: 1 })).status, 409);
  // вывод
  const w = await seller.call('POST', '/api/wallet/withdraw', { amountCents: 99000 }, { 'idempotency-key': key() });
  assert.equal(w.data.user.balanceCents, 0);
  assert.equal((await seller.call('POST', '/api/wallet/withdraw', { amountCents: 1 }, { 'idempotency-key': key() })).status, 400);
});

test('спор и решение администратора с разделением средств', async () => {
  const seller = await verifiedUser('Seller Two', 's2@test.io');
  const buyer = await verifiedUser('Buyer Two', 'b2@test.io');
  const d = (await buyer.call('POST', '/api/deals', { title: 'Аренда квартиры', category: 'rent', amountCents: 50000, myRole: 'buyer', feePayer: 'buyer' })).data;
  await seller.call('POST', `/api/invite/${d.inviteUrl.split('/invite/')[1]}/accept`);
  await buyer.call('POST', `/api/deals/${d.id}/pay`, undefined, { 'idempotency-key': key() });
  assert.equal((await buyer.call('POST', `/api/deals/${d.id}/dispute`, { reason: 'коротко' })).status, 400);
  assert.equal((await buyer.call('POST', `/api/deals/${d.id}/dispute`, { reason: 'Квартира не соответствует описанию' })).data.status, 'disputed');
  // обычный пользователь не может решать споры
  assert.equal((await buyer.call('POST', `/api/admin/deals/${d.id}/resolve`, { decision: 'buyer', comment: 'хочу назад' })).status, 403);

  const admin = await verifiedUser('Admin', 'admin@test.io');
  db.prepare("UPDATE users SET role='admin' WHERE email='admin@test.io'").run();
  const r = await admin.call('POST', `/api/admin/deals/${d.id}/resolve`, { decision: 'split', buyerPercent: 60, comment: 'Частичное несоответствие' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = (await buyer.call('GET', `/api/deals/${d.id}`)).data;
  assert.equal(after.status, 'resolved');
  assert.equal(after.resolution.buyerCents + after.resolution.sellerCents, 51000);
  const ov = (await admin.call('GET', '/api/admin/overview')).data;
  assert.ok(ov.ledger.ok, 'ledger invariants');
  assert.ok(ov.audit.ok, 'audit chain');
});

test('безопасность: IDOR, CSRF, валидация, загрузка файлов, блокировка', async () => {
  const a = await verifiedUser('User A', 'a@test.io');
  const b = await verifiedUser('User B', 'b@test.io');
  const d = (await a.call('POST', '/api/deals', { title: 'Приватная сделка', category: 'service', amountCents: 10000, myRole: 'buyer' })).data;
  // чужая сделка недоступна
  assert.equal((await b.call('GET', `/api/deals/${d.id}`)).status, 404);
  assert.equal((await b.call('GET', `/api/deals/${d.id}/messages`)).status, 404);
  // лишние поля отклоняются (mass assignment)
  assert.equal((await a.call('POST', '/api/deals', { title: 'X deal', category: 'goods', amountCents: 1000, myRole: 'buyer', status: 'completed' })).status, 400);
  // отрицательная сумма
  assert.equal((await a.call('POST', '/api/deals', { title: 'X deal', category: 'goods', amountCents: -5, myRole: 'buyer' })).status, 400);
  // CSRF: без токена
  a.csrf = 'wrong';
  assert.equal((await a.call('POST', '/api/deals', { title: 'CSRF', category: 'goods', amountCents: 1000, myRole: 'buyer' })).status, 403);
  // чужой Origin
  assert.equal((await b.call('POST', '/api/auth/logout', undefined, { origin: 'https://evil.example' })).status, 403);
  // загрузка: исполняемый/HTML-файл отклоняется
  assert.equal((await b.call('POST', '/api/files', Buffer.from('<script>alert(1)</script>'), { 'x-purpose': 'support' })).status, 415);
  // KYC-файл другого пользователя недоступен
  const kycFile = db.prepare("SELECT f.id FROM files f JOIN users u ON u.id=f.owner_id WHERE u.email='a@test.io'").get();
  assert.equal((await b.call('GET', `/api/files/${kycFile.id}`)).status, 404);
  // PII зашифрованы в БД, номер карты не хранится
  const row = db.prepare("SELECT * FROM users WHERE email='a@test.io'").get();
  assert.ok(!row.kyc_passport_enc.includes('ID1234567'));
  assert.ok(!JSON.stringify(row).includes('4242424242424242'));
  assert.match(row.password_hash, /^\$argon2id\$/);
  // блокировка после 5 неудачных попыток
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/api/auth/login', { email: 'b@test.io', password: 'wrong-password-1' })).status, 401);
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'b@test.io', password: 'Str0ngPassw0rd' })).status, 429);
  // слабый пароль
  assert.equal((await client().call('POST', '/api/auth/register', { name: 'Weak', email: 'w@test.io', password: 'password123' })).status, 400);
  // заголовки безопасности
  const h = (await client().call('GET', '/api/health')).headers;
  assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(h.get('x-content-type-options'), 'nosniff');
});

test('отклонённый платёж не меняет состояние', async () => {
  const s = await verifiedUser('Seller D', 'sd@test.io');
  const bb = await verifiedUser('Buyer D', 'bd@test.io', '4000000000000002');
  const d = (await s.call('POST', '/api/deals', { title: 'Камера', category: 'goods', amountCents: 20000, myRole: 'seller' })).data;
  await bb.call('POST', `/api/invite/${d.inviteUrl.split('/invite/')[1]}/accept`);
  const p = await bb.call('POST', `/api/deals/${d.id}/pay`, undefined, { 'idempotency-key': key() });
  assert.equal(p.status, 402);
  assert.equal((await bb.call('GET', `/api/deals/${d.id}`)).data.status, 'awaiting_payment');
  assert.ok(checkInvariants().ok);
  assert.ok(verifyAuditChain().ok);
});

test('журнал аудита защищён от изменения', () => {
  assert.throws(() => db.prepare("UPDATE audit_log SET action='x'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM ledger').run(), /append-only/);
});

test('регрессия: админский список обращений в поддержку и профиль с отзывами', async () => {
  // лимит регистраций (10/час с IP) уже исчерпан предыдущими тестами — входим существующими пользователями
  const login = async (email) => { const c = client(); assert.equal((await c.call('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd' })).status, 200); return c; };
  const u = await login('s2@test.io');
  assert.equal((await u.call('GET', '/api/support/messages')).status, 200);
  assert.equal((await u.call('POST', '/api/support/messages', { text: 'Помогите' })).status, 201);
  const admin = await login('admin@test.io');
  const inbox = await admin.call('GET', '/api/admin/support');
  assert.equal(inbox.status, 200, JSON.stringify(inbox.data));
  const t = inbox.data.find((x) => x.name === 'Seller Two');
  assert.ok(t && t.needsReply, 'тред с ответом от бота должен ждать оператора');
  // профиль: число отзывов и список — разные поля
  const me = (await u.call('GET', '/api/auth/me')).data.user;
  const p = (await admin.call('GET', `/api/users/${me.id}`)).data;
  assert.equal(typeof p.reviews, 'number');
  assert.ok(Array.isArray(p.reviewList));
});
