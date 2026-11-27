# Kelishen — trust in every deal

Kelishen is an MVP of a safe-deal (escrow) service between buyers and sellers. The buyer pays, the money is
frozen on the platform, and it is released to the seller only after the buyer confirms receipt. If something
goes wrong, either party can open a dispute, and the Kelishen team decides who gets the money: the seller,
the buyer, or both in a set proportion.

Architecture, technology and security measures are described in [ARCHITECTURE.md](ARCHITECTURE.md) (in Russian).

## Running locally

Requires Node.js ≥ 22.5 (uses the built-in SQLite).

```bash
npm install
npm run build
npm run seed
npm start
```

Open http://localhost:3000. The UI is designed for a phone screen; on desktop it is shown centered.

Development mode with hot reload (API on :3000, Vite on :5173):

```bash
npm run dev
```

Tests:

```bash
npm test
```

## Demo accounts (after `npm run seed`)

| Role | Email | Password |
|---|---|---|
| User | alex@kelishen.local | Demo12345! |
| User | olivia@kelishen.local | Demo12345! |
| Admin | admin@kelishen.local | Admin12345! (local only; in production it comes from `ADMIN_PASSWORD` or is random and printed by `npm run seed`) |

Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is always declined.
Any future expiry date and any 3-digit CVV.

## Demo walkthrough

1. Sign in as **alex**, tap "Create a safe deal", choose "I'm selling" and copy the invite link.
2. In another browser (or an incognito window) open the link, sign in as **olivia** and accept the invite.
3. Olivia pays for the deal: the status becomes "Funds frozen in escrow".
4. Alex taps "I've fulfilled the conditions", Olivia taps "Confirm receipt". The money lands in Alex's balance and can be withdrawn to a card.
5. Dispute flow: after payment tap "Open dispute" and attach a photo or PDF. Sign in as **admin**,
   go to "Profile → Admin panel → Disputes" and issue a decision.
6. A new user verifies their identity after sign-up: full name, passport, photo, card.
   In dev mode the application is approved automatically. To review applications manually in the admin panel,
   start the server with `KYC_AUTO_APPROVE=0`.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | port (default 3000) |
| `PUBLIC_URL` | public URL used for invite links and the Origin check |
| `NODE_ENV=production` | enables `__Host-` Secure cookies and HSTS, and requires `SAFEDEAL_MASTER_KEY` |
| `SAFEDEAL_MASTER_KEY` | 32 bytes in base64 — encryption key for personal data and files (`openssl rand -base64 32`) |
| `KYC_AUTO_APPROVE=0` | disable automatic KYC approval |
| `TRUST_PROXY` | value for `app.set('trust proxy')` behind a load balancer |
| `DATA_DIR` | folder for the database, files and key (default `./data`) |

Reset data: delete the `data/` folder and run `npm run seed` again.

## Brand

Colors, typography and graphics follow the Kelishen brand book: Primary Blue `#2183F5`, Light Blue `#6DBBFA`,
White `#FDFDFD`, Accent Orange `#F15A24` (rare); Nunito for UI text; the connected-shields pattern at 5–12% opacity;
the snowflake marks funds temporarily frozen in escrow.
