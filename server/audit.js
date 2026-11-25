import { db, now } from './db.js';
import { sha256 } from './crypto.js';

const digest = (r) => sha256([r.prev_hash, r.at, r.actor_id ?? '', r.action, r.entity ?? '', r.entity_id ?? '', r.meta, r.ip ?? ''].join('|'));

export function audit({ actorId = null, action, entity = null, entityId = null, meta = {}, ip = null }) {
  const prev = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
  const row = { at: now(), actor_id: actorId, action, entity, entity_id: entityId, meta: JSON.stringify(meta), ip, prev_hash: prev?.hash ?? 'GENESIS' };
  row.hash = digest(row);
  db.prepare(`INSERT INTO audit_log (at, actor_id, action, entity, entity_id, meta, ip, prev_hash, hash)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(row.at, row.actor_id, row.action, row.entity, row.entity_id, row.meta, row.ip, row.prev_hash, row.hash);
}

/** Проверка целостности цепочки: любая подмена записи ломает все последующие хэши. */
export function verifyAuditChain() {
  let prev = 'GENESIS';
  let count = 0;
  for (const r of db.prepare('SELECT * FROM audit_log ORDER BY id').iterate()) {
    if (r.prev_hash !== prev || digest(r) !== r.hash) return { ok: false, brokenAt: r.id, count };
    prev = r.hash;
    count++;
  }
  return { ok: true, count, head: prev };
}
