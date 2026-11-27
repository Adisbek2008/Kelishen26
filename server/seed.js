// Демо-данные: администратор и два верифицированных пользователя со сделками в разных статусах
import { hash } from '@node-rs/argon2';
import { db, now, tx } from './db.js';
import { uuid, encryptPII, randomToken } from './crypto.js';
import { config } from './config.js';
import { post } from './ledger.js';
import { feeSplit, nextDealCode, dealEvent, systemMessage } from './services.js';
import { audit } from './audit.js';

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has data — skipping seed. Delete the data/ folder to recreate it.');
  process.exit(0);
}

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
async function user(name, email, password, role = 'user', last4 = '4589') {
  const id = uuid();
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, kyc_status, kyc_full_name_enc, kyc_passport_enc,
              card_token, card_last4, card_brand, card_exp, created_at) VALUES (?,?,?,?,?,'verified',?,?,?,?,'VISA','12/29',?)`)
    .run(id, email, name, await hash(password, ARGON), role, encryptPII(name), encryptPII('ID' + Math.floor(1e6 + Math.random() * 9e6)),
      'tok_' + randomToken(18), last4, now());
  audit({ actorId: id, action: 'seed.user', entity: 'user', entityId: id });
  return id;
}

// В production пароль админа не может быть известным: берём из ADMIN_PASSWORD или генерируем случайный
const adminPassword = process.env.ADMIN_PASSWORD || (config.isProd ? randomToken(12) + '9a' : 'Admin12345!');
const admin = await user('Kelishen Admin', 'admin@kelishen.local', adminPassword, 'admin', '0001');
const alex = await user('Alex Morgan', 'alex@kelishen.local', 'Demo12345!', 'user', '4589');
const olivia = await user('Olivia Reed', 'olivia@kelishen.local', 'Demo12345!', 'user', '7712');

function deal({ title, category, amount, buyer, seller, creator, status, feePayer = 'split', conditions = '' }) {
  const id = uuid();
  const f = feeSplit(amount, feePayer);
  db.prepare(`INSERT INTO deals (id, code, title, description, category, conditions, amount_cents, fee_cents, fee_payer, creator_id, buyer_id, seller_id,
              status, invite_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, nextDealCode(), title, '', category, conditions, amount, f.fee, feePayer, creator, buyer, seller, status,
      status === 'pending_partner' ? randomToken(24) : null, now(), now());
  dealEvent(id, creator, 'created', 'Deal created');
  if (['funds_reserved', 'completed', 'disputed'].includes(status)) {
    post('hold', [{ account: 'card:' + buyer, amount: -f.buyerPays, userId: buyer }, { account: 'escrow:' + id, amount: f.buyerPays }], { dealId: id, description: 'Deal payment (held)' });
    dealEvent(id, buyer, 'paid', 'Funds frozen in escrow');
  }
  if (status === 'completed') {
    post('release', [{ account: 'escrow:' + id, amount: -f.buyerPays }, { account: 'user:' + seller, amount: f.sellerGets, userId: seller }, { account: 'platform:fees', amount: f.fee }], { dealId: id, description: 'Deal payout' });
    dealEvent(id, buyer, 'released', 'Buyer confirmed the deal. Funds released to the seller');
    db.prepare('INSERT INTO reviews (deal_id, author_id, target_id, rating, comment, created_at) VALUES (?,?,?,?,?,?)').run(id, buyer, seller, 5, 'Everything was great — fast and honest!', now());
  }
  systemMessage('deal', id, 'Deal created.');
  return id;
}

tx(() => {
  deal({ title: 'iPhone 15 Pro', category: 'goods', amount: 109900, buyer: alex, seller: olivia, creator: alex, status: 'funds_reserved', conditions: 'Brand new, sealed, courier delivery' });
  deal({ title: 'Brand identity design', category: 'service', amount: 85000, buyer: olivia, seller: alex, creator: alex, status: 'awaiting_payment', conditions: 'Logo + brand book, 2 rounds of revisions' });
  deal({ title: 'Website redesign', category: 'service', amount: 240000, buyer: olivia, seller: alex, creator: olivia, status: 'completed' });
  deal({ title: 'Sony A7 IV camera rental, 3 days', category: 'rent', amount: 17500, buyer: alex, seller: null, creator: alex, status: 'pending_partner' });
});
console.log(`Done. Demo accounts:
  admin@kelishen.local / ${adminPassword}
  alex@kelishen.local  / Demo12345!
  olivia@kelishen.local / Demo12345!`);
