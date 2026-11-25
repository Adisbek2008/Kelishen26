import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { db, now, tx } from './db.js';
import { HttpError } from './http.js';
import { sessionMiddleware, csrfProtect } from './auth.js';
import { audit } from './audit.js';
import authRoutes from './routes/auth.js';
import kycRoutes from './routes/kyc.js';
import fileRoutes from './routes/files.js';
import dealRoutes, { invites, releaseFunds } from './routes/deals.js';
import miscRoutes from './routes/misc.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  // Заголовки безопасности: строгий CSP без inline-скриптов, HSTS, запрет фреймов, no-referrer
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: config.isProd ? { policy: 'same-origin' } : false,
  }));
  app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); next(); });

  const limiter = (windowMin, limit) => rateLimit({ windowMs: windowMin * 60e3, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Слишком много запросов, попробуйте позже', code: 'rate_limited' } });

  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', limiter(1, 300));
  app.use('/api/auth/login', limiter(15, 20));
  app.use('/api/auth/register', limiter(60, 10));
  app.use('/api/invite', limiter(15, 60));
  app.use('/api/deals/:id/pay', limiter(10, 20));

  app.use('/api', express.json({ limit: '64kb' }));
  app.use('/api', sessionMiddleware, csrfProtect);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/kyc', kycRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/deals', dealRoutes);
  app.use('/api/invite', invites);
  app.use('/api/admin', adminRoutes);
  app.use('/api', miscRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  const dist = path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Единый обработчик ошибок: клиенту — только безопасное сообщение, без стек-трейсов
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
    console.error('[error]', req.method, req.path, err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });
  return app;
}

/** Фоновые задачи: авто-подтверждение сделок, очистка истёкших сессий. */
export function runSweep() {
  const cutoff = new Date(Date.now() - config.autoReleaseDays * 864e5).toISOString();
  for (const d of db.prepare("SELECT * FROM deals WHERE status = 'delivered' AND delivered_at < ?").all(cutoff)) {
    try {
      tx(() => {
        const u = db.prepare("UPDATE deals SET status='completed', updated_at=?, version=version+1 WHERE id=? AND status='delivered'").run(now(), d.id);
        if (u.changes !== 1) return;
        releaseFunds(d, null, `Покупатель не ответил ${config.autoReleaseDays} дн. — сделка подтверждена автоматически`);
        audit({ action: 'deal.auto_release', entity: 'deal', entityId: d.id });
      });
    } catch (e) { console.error('[sweep]', d.code, e.message); }
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen < ?').run(Date.now(), Date.now() - config.sessionIdleMs);
}
