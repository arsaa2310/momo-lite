import { Router } from 'express';
import { one, q } from '../lib/db.ts';
import { bad } from '../lib/http.ts';
import { only, restoId } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';
import { moneyFlow, pending, periodOf } from './summary.ts';

// Owner: memantau semua resto miliknya sekaligus & mengatur shift laporan pendapatan resto yang sedang dibuka.
const r = Router();
r.use(only('owner'));

r.get('/overview', async (req, res) => {
  const { from, to } = periodOf(req);
  if (from > to) throw bad('Tanggal awal melewati tanggal akhir');
  const restos = await q(
    `SELECT r.id, r.name, r.code, r.shift_names, (SELECT max(l.created_at) FROM activity_logs l WHERE l.resto_id = r.id) AS last_activity
       FROM restos r WHERE r.id = ANY($1) ORDER BY r.name`, [req.s.restoIds]);
  const rows = await Promise.all(restos.map(async (x) => {
    const [flow, wait, reports] = await Promise.all([
      moneyFlow(x.id, from, to),
      pending(x.id),
      // kelengkapan laporan shift di periode (sampai hari ini)
      one(`SELECT count(*)::int AS n, GREATEST(0, (LEAST($3::date, (now() AT TIME ZONE 'Asia/Jakarta')::date) - $2::date + 1))::int AS days
             FROM revenue_reports WHERE resto_id = $1 AND status <> 'void' AND report_date BETWEEN $2 AND $3`, [x.id, from, to]),
    ]);
    return { ...x, ...flow, ...wait, reports: reports.n, reports_expected: reports.days * (x.shift_names as string[]).length };
  }));
  res.json({ from, to, restos: rows });
});

// Nama shift laporan pendapatan resto yang sedang dibuka. Satu nama (mis. "Harian") = laporan per hari.
r.put('/shifts', async (req, res) => {
  const rid = restoId(req);
  const names = [...new Map(((req.body.shift_names ?? []) as unknown[])
    .map((s) => String(s ?? '').trim()).filter(Boolean).map((s) => [s.toLowerCase(), s])).values()];
  if (!names.length) throw bad('Isi minimal satu shift (mis. Harian)');
  if (names.length > 6) throw bad('Maksimal 6 shift');
  if (names.some((s) => s.length > 30)) throw bad('Nama shift maksimal 30 karakter');
  const old = await one(`SELECT shift_names FROM restos WHERE id = $1`, [rid]);
  await q(`UPDATE restos SET shift_names = $2 WHERE id = $1`, [rid, names]);
  await log(req, { action: 'update', entity: 'resto', entityId: rid, detail: `Mengubah shift laporan pendapatan: ${(old.shift_names as string[]).join(', ')} → ${names.join(', ')}` });
  res.json({ shift_names: names });
});

export default r;
