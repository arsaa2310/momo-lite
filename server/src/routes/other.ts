import { Router, type Request } from 'express';
import { one, q, tx } from '../lib/db.ts';
import { HttpError, bad, notFound, num } from '../lib/http.ts';
import { ADMIN_ROLES, isAdmin, only, restoId } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';
import { nextNumber } from '../lib/numbers.ts';
import { extraPhotos, requirePhoto } from '../lib/uploads.ts';

// Pengeluaran lain (listrik, gas, servis, sewa, …): hanya Manager, Central Admin, Owner. Tunai (PTH) dari kas / rekening, wajib foto nota.
// Input Manager menunggu persetujuan Central Admin / Owner; input Central Admin / Owner langsung disetujui.
// Masuk jurnal umum setelah disetujui. Yang sudah disetujui bisa dibatalkan Central Admin / Owner (salah input).
const r = Router();
r.use('/other-expenses', only('manager', 'central', 'owner'));

const rpText = (n: unknown) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;
const xLog = (req: Request, c: any, id: number, action: string, detail: string) => log(req, { action, entity: 'other_expense', entityId: id, detail }, c);

const HEAD = `
  SELECT x.*, u1.name AS created_by_name, u1.role AS created_by_role, u2.name AS decided_by_name, u3.name AS voided_by_name, pa.name AS pay_account_name,
         (SELECT count(*)::int FROM other_expense_lines l WHERE l.expense_id = x.id) AS line_count,
         (SELECT string_agg(l.description, ', ' ORDER BY l.id) FROM other_expense_lines l WHERE l.expense_id = x.id) AS item_names,
         (SELECT string_agg(DISTINCT l.category, ', ') FROM other_expense_lines l WHERE l.expense_id = x.id) AS categories
    FROM other_expenses x LEFT JOIN users u1 ON u1.id = x.created_by LEFT JOIN users u2 ON u2.id = x.decided_by LEFT JOIN users u3 ON u3.id = x.voided_by
    LEFT JOIN pay_accounts pa ON pa.id = x.pay_account_id`;

r.get('/other-expenses', async (req, res) => {
  const rid = restoId(req);
  const params: unknown[] = [rid];
  const where = ['x.resto_id = $1'];
  const st = String(req.query.status ?? '');
  if (['approval', 'approved', 'rejected', 'void'].includes(st)) { params.push(st); where.push(`x.status = $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from))) { params.push(req.query.from); where.push(`x.expense_date >= $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to))) { params.push(req.query.to); where.push(`x.expense_date <= $${params.length}`); }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(x.number ILIKE $${params.length} OR x.payee ILIKE $${params.length} OR EXISTS (SELECT 1 FROM other_expense_lines l WHERE l.expense_id = x.id AND (l.description ILIKE $${params.length} OR l.category ILIKE $${params.length})))`);
  }
  const w = where.join(' AND ');
  const page = Math.max(1, Number(req.query.page) || 1), size = Math.min(200, Number(req.query.size) || 30);
  const agg = await one(`SELECT count(*)::int AS n, COALESCE(sum(x.total) FILTER (WHERE x.status = 'approved'), 0) AS sum FROM other_expenses x WHERE ${w}`, params);
  const data = await q(`${HEAD} WHERE ${w} ORDER BY x.expense_date DESC, x.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
  const counts = await q(`SELECT status, count(*)::int n FROM other_expenses WHERE resto_id = $1 GROUP BY status`, [rid]);
  res.json({ data, total: agg.n, sum: agg.sum, page, size, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
});

r.get('/other-expenses/:id', async (req, res) => {
  const x = await one(`${HEAD} WHERE x.id = $1 AND x.resto_id = $2`, [Number(req.params.id) || 0, restoId(req)]);
  if (!x) throw notFound('Pengeluaran');
  const lines = await q(`SELECT * FROM other_expense_lines WHERE expense_id = $1 ORDER BY id`, [x.id]);
  const logs = await q(`SELECT id, user_name, user_role, action, detail, created_at FROM activity_logs WHERE entity = 'other_expense' AND entity_id = $1 ORDER BY created_at, id`, [x.id]);
  res.json({ ...x, lines, logs });
});

r.post('/other-expenses', async (req, res) => {
  const rid = restoId(req);
  const date = String(req.body.expense_date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Isi tanggal pengeluaran');
  const payee = String(req.body.payee ?? '').trim();
  if (!payee) throw bad('Isi dibayar ke siapa (mis. PLN, nama toko / tukang)');
  const raw: any[] = req.body.lines ?? [];
  if (!raw.length) throw bad('Tambahkan minimal satu baris');
  const lines = raw.map((l) => {
    const description = String(l.description ?? '').trim();
    if (!description) throw bad('Isi keterangan setiap baris');
    const category = String(l.category ?? '').trim();
    if (!category) throw bad(`Pilih kategori untuk "${description}"`);
    const qty = l.qty === undefined || l.qty === '' || l.qty === null ? 1 : num(l.qty, `Jumlah ${description}`);
    if (qty <= 0) throw bad(`Jumlah ${description} harus lebih dari 0`);
    const amount = num(l.amount, `Nominal ${description}`);
    return { description, category, sub_category: String(l.sub_category ?? '').trim() || null, qty, unit: String(l.unit ?? '').trim() || null, amount };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total <= 0) throw bad('Total pengeluaran harus lebih dari 0');
  const direct = isAdmin(req);
  const out = await tx(async (c) => {
    const photo = await requirePhoto(c, rid, 'expense', req.body.receipt_photo_id, 'foto nota / bukti bayar');
    const extra = await extraPhotos(c, rid, 'expense', req.body.extra_photo_ids);
    const acc = await one(`SELECT id, name FROM pay_accounts WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL`, [Number(req.body.pay_account_id) || 0, rid], c);
    if (!acc) throw bad('Pilih kas / rekening pembayaran');
    const x = await one(
      `INSERT INTO other_expenses (resto_id, number, expense_date, payee, pay_account_id, total, receipt_photo_id, extra_photo_ids, notes, status, created_by, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, number, status`,
      [rid, await nextNumber(c, 'other_expenses', 'PL', rid), date, payee, acc.id, total, photo, extra, String(req.body?.notes ?? '').trim() || null,
       direct ? 'approved' : 'approval', req.s.userId, direct ? req.s.userId : null, direct ? new Date() : null],
      c,
    );
    for (const l of lines)
      await q(`INSERT INTO other_expense_lines (expense_id, description, category, sub_category, qty, unit, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [x.id, l.description, l.category, l.sub_category, l.qty, l.unit, l.amount], c);
    await xLog(req, c, x.id, 'create', `Mencatat pengeluaran lain ${x.number} ke ${payee}: ${lines.length} baris, ${rpText(total)} dari ${acc.name}${direct ? '' : ' — menunggu persetujuan Central Admin / Owner'}`);
    return x;
  });
  res.status(201).json(out);
});

async function lockOwn(req: Request, c: any) {
  const x = await one(`SELECT * FROM other_expenses WHERE id = $1 AND resto_id = $2 FOR UPDATE`, [Number(req.params.id) || 0, restoId(req)], c);
  if (!x) throw notFound('Pengeluaran');
  return x;
}
const noteOf = (req: Request, label: string) => {
  const note = String(req.body?.note ?? '').trim();
  if (!note) throw bad(`Isi alasan ${label}`);
  return note;
};

// Persetujuan (Central Admin / Owner)
r.post('/other-expenses/:id/approve', only(...ADMIN_ROLES), async (req, res) => {
  await tx(async (c) => {
    const x = await lockOwn(req, c);
    if (x.status !== 'approval') throw bad(`${x.number} sudah diproses`);
    await q(`UPDATE other_expenses SET status = 'approved', decided_by = $2, decided_at = now(), decide_note = $3 WHERE id = $1`,
      [x.id, req.s.userId, String(req.body?.note ?? '').trim() || null], c);
    await xLog(req, c, x.id, 'approve', `Menyetujui pengeluaran lain ${x.number} ${rpText(x.total)}`);
  });
  res.json({ ok: true });
});
r.post('/other-expenses/:id/reject', only(...ADMIN_ROLES), async (req, res) => {
  await tx(async (c) => {
    const x = await lockOwn(req, c);
    if (x.status !== 'approval') throw bad(`${x.number} sudah diproses`);
    const note = noteOf(req, 'penolakan');
    await q(`UPDATE other_expenses SET status = 'rejected', decided_by = $2, decided_at = now(), decide_note = $3 WHERE id = $1`, [x.id, req.s.userId, note], c);
    await xLog(req, c, x.id, 'reject', `Menolak pengeluaran lain ${x.number}: ${note}`);
  });
  res.json({ ok: true });
});
// Batalkan yang sudah disetujui (salah input): keluar dari jurnal umum
r.post('/other-expenses/:id/void', only(...ADMIN_ROLES), async (req, res) => {
  await tx(async (c) => {
    const x = await lockOwn(req, c);
    if (x.status !== 'approved') throw bad('Hanya pengeluaran yang sudah disetujui yang bisa dibatalkan');
    const note = noteOf(req, 'pembatalan');
    await q(`UPDATE other_expenses SET status = 'void', voided_by = $2, voided_at = now(), void_note = $3 WHERE id = $1`, [x.id, req.s.userId, note], c);
    await xLog(req, c, x.id, 'void', `Membatalkan pengeluaran lain ${x.number}: ${note}`);
  });
  res.json({ ok: true });
});
// Pembuat menarik pengajuannya sendiri selama belum diproses
r.delete('/other-expenses/:id', async (req, res) => {
  await tx(async (c) => {
    const x = await lockOwn(req, c);
    if (x.status !== 'approval') throw bad('Hanya pengajuan yang belum diproses yang bisa ditarik');
    if (x.created_by !== req.s.userId && !isAdmin(req)) throw new HttpError(403, 'Hanya pembuatnya yang bisa menarik pengajuan ini');
    await q(`UPDATE other_expenses SET status = 'rejected', decided_by = $2, decided_at = now(), decide_note = 'Ditarik pembuat' WHERE id = $1`, [x.id, req.s.userId], c);
    await xLog(req, c, x.id, 'cancel', `Menarik pengajuan pengeluaran lain ${x.number}`);
  });
  res.status(204).end();
});

export default r;
