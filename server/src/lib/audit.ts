import type { Request } from 'express';
import { pool, q, type Db } from './db.ts';

// Log aktivitas: siapa, kapan, apa. Dilihat Super Admin (semua resto) dan Central Admin (resto-nya).
export async function log(
  req: Request,
  x: { action: string; entity?: string; entityId?: number | null; detail: string; restoId?: number | null },
  db: Db = pool,
) {
  await q(
    `INSERT INTO activity_logs (resto_id, user_id, user_name, user_role, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [x.restoId !== undefined ? x.restoId : req.s?.restoId ?? null, req.s?.userId ?? null, req.s?.name ?? null, req.s?.role ?? null,
     x.action, x.entity ?? null, x.entityId ?? null, x.detail, req.ip ?? null],
    db,
  );
}
