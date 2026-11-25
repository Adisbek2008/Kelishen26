import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, now } from '../db.js';
import { config, UPLOAD_DIR } from '../config.js';
import { uuid, sha256, encryptFile, decryptFile, randomToken } from '../crypto.js';
import { audit } from '../audit.js';
import { fail, clientIp } from '../http.js';
import { requireAuth } from '../auth.js';

// Белый список по сигнатурам (magic bytes), а не по расширению/Content-Type клиента
const SIGNATURES = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function canReadFile(user, f) {
  if (user.role === 'admin') return true;
  if (f.owner_id === user.id) return true;
  if (f.purpose === 'deal' && f.deal_id) {
    const d = db.prepare('SELECT buyer_id, seller_id FROM deals WHERE id = ?').get(f.deal_id);
    return !!d && (d.buyer_id === user.id || d.seller_id === user.id);
  }
  return false; // kyc и support файлы — только владелец и администратор
}

export const fileView = (f) => f && ({ id: f.id, name: f.original_name, mime: f.mime, size: f.size });

const r = Router();

r.post('/', requireAuth, express.raw({ type: 'application/octet-stream', limit: config.maxUploadBytes }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) fail(400, 'Пустой файл');
  const purpose = String(req.get('x-purpose') || '');
  if (!['kyc', 'deal', 'support'].includes(purpose)) fail(400, 'Неверное назначение файла');
  const sig = SIGNATURES.find((s) => s.test(buf));
  if (!sig) fail(415, 'Разрешены только PDF, PNG, JPEG, WEBP');
  if (purpose === 'kyc' && sig.mime === 'application/pdf') fail(415, 'Для паспорта нужно фото (JPG/PNG)');

  let dealId = null;
  if (purpose === 'deal') {
    dealId = String(req.get('x-deal-id') || '');
    const d = db.prepare('SELECT buyer_id, seller_id FROM deals WHERE id = ?').get(dealId);
    if (!d || (d.buyer_id !== req.user.id && d.seller_id !== req.user.id)) fail(404, 'Сделка не найдена');
  }
  let name = 'file';
  try { name = decodeURIComponent(String(req.get('x-file-name') || 'file')); } catch { /* ignore */ }
  name = name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'file';
  if (!name.toLowerCase().endsWith('.' + sig.ext)) name += '.' + sig.ext;

  const id = uuid();
  const stored = randomToken(24); // имя на диске не связано с пользовательским
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), encryptFile(buf), { mode: 0o600 });
  db.prepare(`INSERT INTO files (id, owner_id, deal_id, purpose, original_name, mime, size, sha256, stored_name, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, req.user.id, dealId, purpose, name, sig.mime, buf.length, sha256(buf), stored, now());
  audit({ actorId: req.user.id, action: 'file.upload', entity: 'file', entityId: id, meta: { purpose, size: buf.length, mime: sig.mime }, ip: clientIp(req) });
  res.status(201).json({ id, name, mime: sig.mime, size: buf.length });
});

r.get('/:id', requireAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(String(req.params.id));
  if (!f || !canReadFile(req.user, f)) fail(404, 'Файл не найден');
  if (f.purpose === 'kyc' && req.user.id !== f.owner_id) {
    audit({ actorId: req.user.id, action: 'pii.kyc_file_viewed', entity: 'file', entityId: f.id, ip: clientIp(req) });
  }
  const data = decryptFile(fs.readFileSync(path.join(UPLOAD_DIR, f.stored_name)));
  if (sha256(data) !== f.sha256) fail(500, 'Нарушена целостность файла');
  const inline = req.query.inline === '1' && f.mime.startsWith('image/');
  res.set({
    'Content-Type': f.mime,
    'Content-Length': data.length,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
});

export default r;
