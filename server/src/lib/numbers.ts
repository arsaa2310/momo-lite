import type { PoolClient } from 'pg';
import { one } from './db.ts';

// Nomor dokumen berurutan per resto dengan kode resto: PO-RST-00001, BH-RST-00001 (belanja harian), BK-RST-00001 (belanja karyawan).
export async function nextNumber(c: PoolClient, table: 'purchase_orders' | 'expenses', prefix: string, restoId: number) {
  const head = `${prefix}-${(await one(`SELECT upper(code) AS code FROM restos WHERE id = $1`, [restoId], c)).code}-`;
  // kunci per resto + jenis agar dua dokumen yang dibuat bersamaan tidak mendapat nomor sama
  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [head]);
  const r = await one(
    `SELECT COALESCE(max(substring(t.number FROM '\\d+$')::int), 0) + 1 AS n FROM ${table} t WHERE t.resto_id = $1 AND t.number LIKE $2`,
    [restoId, `${head}%`],
    c,
  );
  return `${head}${String(r.n).padStart(5, '0')}`;
}
