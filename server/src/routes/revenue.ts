import { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import { one, q, tx } from '../lib/db.ts';
import { HttpError, bad, notFound, num } from '../lib/http.ts';
import { ADMIN_ROLES, isAdmin, only, restoId } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';
import { nextNumber } from '../lib/numbers.ts';
import { extraPhotos } from '../lib/uploads.ts';

// Pendapatan per shift: Manager mengisi uang masuk setiap akhir shift, dirinci per metode bayar (Tunai, QRIS, …).
// Nama shift diatur Owner (satu nama, mis. "Harian" = laporan per hari). Satu laporan per tanggal + shift.
// Manager masih bisa mengoreksi selama belum dicek (dikunci) Central Admin / Owner. Masuk jurnal umum sebagai PNDPTN.
const r = Router();
r.use('/revenue', only('manager', 'central', 'owner'));

const rpText = (n: unknown) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;
const rLog = (req: Request, c: PoolClient, id: number, action: string, detail: string) => log(req, { action, entity: 'revenue', entityId: id, detail }, c);

const HEAD = `
  SELECT x.*, u1.name AS created_by_name, u2.name AS updated_by_name, u3.name AS verified_by_name, u4.name AS voided_by_name,
         COALESCE((SELECT json_agg(json_build_object('method_id', l.method_id, 'method_name', l.method_name, 'amount', l.amount,
                                                     'pay_account_name', pa.name) ORDER BY l.id)
                     FROM revenue_report_lines l LEFT JOIN pay_accounts pa ON pa.id = l.pay_account_id WHERE l.report_id = x.id), '[]') AS lines
    FROM revenue_reports x LEFT JOIN users u1 ON u1.id = x.created_by LEFT JOIN users u2 ON u2.id = x.updated_by
    LEFT JOIN users u3 ON u3.id = x.verified_by LEFT JOIN users u4 ON u4.id = x.voided_by`;

r.get('/revenue', async (req, res) => {
  const rid = restoId(req);
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : today;
  const params: unknown[] = [rid, from, to];
  const where = ['x.resto_id = $1', 'x.report_date BETWEEN $2 AND $3'];
  const st = String(req.query.status ?? '');
  if (['submitted', 'verified', 'void'].includes(st)) { params.push(st); where.push(`x.status = $${params.length}`); }
  else where.push(`x.status <> 'void'`);
  const data = await q(`${HEAD} WHERE ${where.join(' AND ')} ORDER BY x.report_date DESC, x.shift, x.id DESC`, params);
  const resto = await one(`SELECT shift_names FROM restos WHERE id = $1`, [rid]);
  // rekap per metode & shift yang belum dilaporkan (7 hari terakhir periode, sampai hari ini)
  const byMethod = await q(
    `SELECT l.method_name, sum(l.amount) AS amount FROM revenue_report_lines l JOIN revenue_reports x ON x.id = l.report_id
      WHERE x.resto_id = $1 AND x.report_date BETWEEN $2 AND $3 AND x.status <> 'void' GROUP BY 1 ORDER BY 2 DESC`, [rid, from, to]);
  const missing = await q(
    `SELECT d::date::text AS date, s.shift FROM generate_series(GREATEST($2::date, LEAST($3::date, $4::date) - 6), LEAST($3::date, $4::date), '1 day') d
       CROSS JOIN unnest($5::text[]) s(shift)
      WHERE NOT EXISTS (SELECT 1 FROM revenue_reports x WHERE x.resto_id = $1 AND x.report_date = d::date AND lower(x.shift) = lower(s.shift) AND x.status <> 'void')
      ORDER BY 1 DESC, 2 LIMIT 62`, [rid, from, to, today, resto.shift_names]);
  const total = data.reduce((s, x) => s + (x.status === 'void' ? 0 : Number(x.total)), 0);
  res.json({ from, to, data, total, by_method: byMethod, missing, shifts: resto.shift_names });
});

r.get('/revenue/:id', async (req, res) => {
  const x = await one(`${HEAD} WHERE x.id = $1 AND x.resto_id = $2`, [Number(req.params.id) || 0, restoId(req)]);
  if (!x) throw notFound('Laporan pendapatan');
  const logs = await q(`SELECT id, user_name, user_role, action, detail, created_at FROM activity_logs WHERE entity = 'revenue' AND entity_id = $1 ORDER BY created_at, id`, [x.id]);
  res.json({ ...x, logs });
});

// Isi laporan dari body: tanggal, shift, nominal per metode (amounts: { method_id: nominal }), jumlah transaksi, catatan, foto
async function parseBody(req: Request, c: PoolClient, rid: number) {
  const date = String(req.body.report_date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Isi tanggal');
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  if (date > today) throw bad('Tanggal tidak boleh melewati hari ini');
  const resto = await one(`SELECT shift_names FROM restos WHERE id = $1`, [rid], c);
  const shift = (resto.shift_names as string[]).find((s) => s.toLowerCase() === String(req.body.shift ?? '').trim().toLowerCase());
  if (!shift) throw bad('Pilih shift');
  const methods = await q(`SELECT id, name, pay_account_id FROM revenue_methods WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY sort, id`, [rid], c);
  const amounts: Record<string, unknown> = req.body.amounts ?? {};
  const lines = methods
    .map((m) => ({ m, amount: amounts[m.id] === undefined || amounts[m.id] === '' || amounts[m.id] === null ? 0 : num(amounts[m.id], `Nominal ${m.name}`) }))
    .filter((x) => x.amount > 0);
  if (!lines.length) throw bad('Isi nominal pendapatan minimal satu metode bayar');
  const trx = req.body.trx_count === undefined || req.body.trx_count === '' || req.body.trx_count === null ? null : Math.round(num(req.body.trx_count, 'Jumlah transaksi'));
  const photos = await extraPhotos(c, rid, 'revenue', req.body.photo_ids);
  return { date, shift, lines, total: lines.reduce((s, l) => s + l.amount, 0), trx, photos, notes: String(req.body?.notes ?? '').trim() || null };
}

async function writeLines(c: PoolClient, id: number, lines: { m: any; amount: number }[]) {
  await q(`DELETE FROM revenue_report_lines WHERE report_id = $1`, [id], c);
  for (const l of lines)
    await q(`INSERT INTO revenue_report_lines (report_id, method_id, method_name, pay_account_id, amount) VALUES ($1,$2,$3,$4,$5)`, [id, l.m.id, l.m.name, l.m.pay_account_id, l.amount], c);
}
const linesText = (lines: { m: any; amount: number }[]) => lines.map((l) => `${l.m.name} ${rpText(l.amount)}`).join(', ');

async function assertFree(c: PoolClient, rid: number, date: string, shift: string, id = 0) {
  const dup = await one(`SELECT number FROM revenue_reports WHERE resto_id = $1 AND report_date = $2 AND lower(shift) = lower($3) AND status <> 'void' AND id <> $4`, [rid, date, shift, id], c);
  if (dup) throw bad(`Pendapatan ${shift} tanggal ${date} sudah dilaporkan (${dup.number}). Buka laporan itu untuk mengoreksi.`);
}

r.post('/revenue', async (req, res) => {
  const rid = restoId(req);
  const out = await tx(async (c) => {
    const d = await parseBody(req, c, rid);
    await assertFree(c, rid, d.date, d.shift);
    const x = await one(
      `INSERT INTO revenue_reports (resto_id, number, report_date, shift, total, trx_count, notes, photo_ids, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, number`,
      [rid, await nextNumber(c, 'revenue_reports', 'PD', rid), d.date, d.shift, d.total, d.trx, d.notes, d.photos, req.s.userId], c);
    await writeLines(c, x.id, d.lines);
    await rLog(req, c, x.id, 'create', `Melaporkan pendapatan ${x.number} ${d.date} shift ${d.shift}: ${rpText(d.total)} (${linesText(d.lines)})`);
    return x;
  });
  res.status(201).json(out);
});

async function lockOwn(req: Request, c: PoolClient) {
  const x = await one(`SELECT * FROM revenue_reports WHERE id = $1 AND resto_id = $2 FOR UPDATE`, [Number(req.params.id) || 0, restoId(req)], c);
  if (!x) throw notFound('Laporan pendapatan');
  return x;
}

// Koreksi: pembuat (Manager) atau Central Admin / Owner, selama belum dicek
r.put('/revenue/:id', async (req, res) => {
  const rid = restoId(req);
  await tx(async (c) => {
    const x = await lockOwn(req, c);
    if (x.status !== 'submitted') throw bad(x.status === 'verified' ? 'Laporan ini sudah dicek dan dikunci. Minta Central Admin / Owner membuka kuncinya.' : 'Laporan ini sudah dibatalkan');
    if (!isAdmin(req) && x.created_by !== req.s.userId) throw new HttpError(403, 'Hanya pembuat laporan, Central Admin, atau Owner yang bisa mengoreksi');
    const d = await parseBody(req, c, rid);
    await assertFree(c, rid, d.date, d.shift, x.id);
    await q(`UPDATE revenue_reports SET report_date = $2, shift = $3, total = $4, trx_count = $5, notes = $6, photo_ids = $7, updated_by = $8, updated_at = now() WHERE id = $1`,
      [x.id, d.date, d.shift, d.total, d.trx, d.notes, d.photos, req.s.userId], c);
    await writeLines(c, x.id, d.lines);
    await rLog(req, c, x.id, 'update', `Mengoreksi pendapatan ${x.number}: ${rpText(x.total)} → ${rpText(d.total)} (${linesText(d.lines)})`);
  });
  res.json({ ok: true });
});

// Cek & kunci / buka kunci (Central Admin / Owner)
r.post('/revenue/:id/verify', only(...ADMIN_ROLES), async (req, res) => {
  await tx(async (c) => {
    const x = await lockOwn(req, c);
    if (x.status !== 'submitted') throw bad('Laporan ini sudah dicek atau dibatalkan');
    await q(`UPDATE revenue_reports SET status = 'verified', verified_by = $2, verified_at = now() WHERE id = $1`, [x.id, req.s.userId], c);
    await rLog(req, c, x.id, 'verify', `Mengecek & mengunci pendapatan ${x.number} ${rpText(x.total)}`);
  });
  res.json({ ok: true });
});
r.post('/revenue/:id/unverify', only(...ADMIN_ROLES), async (req, res) => {
  await tx(async (c) => {
    const x = await lockOwn(req, c);
    if (x.status !== 'verified') throw bad('Laporan ini belum dikunci');
    await q(`UPDATE revenue_reports SET status = 'submitted', verified_by = NULL, verified_at = NULL WHERE id = $1`, [x.id], c);
    await rLog(req, c, x.id, 'verify', `Membuka kunci pendapatan ${x.number} untuk dikoreksi`);
  });
  res.json({ ok: true });
});
r.post('/revenue/:id/void', only(...ADMIN_ROLES), async (req, res) => {
  await tx(async (c) => {
    const x = await lockOwn(req, c);
    if (x.status === 'void') throw bad('Laporan ini sudah dibatalkan');
    const note = String(req.body?.note ?? '').trim();
    if (!note) throw bad('Isi alasan pembatalan');
    await q(`UPDATE revenue_reports SET status = 'void', voided_by = $2, voided_at = now(), void_note = $3 WHERE id = $1`, [x.id, req.s.userId, note], c);
    await rLog(req, c, x.id, 'void', `Membatalkan pendapatan ${x.number}: ${note}`);
  });
  res.json({ ok: true });
});

export default r;
