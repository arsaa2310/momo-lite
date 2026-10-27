import { Router, type Request } from 'express';
import { one, q, tx } from '../lib/db.ts';
import { bad, notFound, num } from '../lib/http.ts';
import { ADMIN_ROLES, RESTO_ROLES, only, restoId } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';
import { nextNumber } from '../lib/numbers.ts';
import { extraPhotos, requirePhoto } from '../lib/uploads.ts';

// Belanja harian (HPP) & belanja karyawan (beban): dari daftar bahan Central Admin, tanpa supplier terdaftar
// (boleh mencatat nama toko), tidak masuk persediaan, selalu tunai (PTH), wajib foto nota. Tanpa approval:
// langsung tercatat di jurnal umum. Central Admin / Owner bisa membatalkan (salah input) dengan alasan.
const r = Router();

const KIND_LABEL = { daily: 'belanja harian', employee: 'belanja karyawan' } as const;
const kindOf = (v: unknown) => (v === 'employee' ? 'employee' : v === 'daily' ? 'daily' : null);
const rpText = (n: unknown) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;

const HEAD = `
  SELECT x.*, u1.name AS created_by_name, u2.name AS voided_by_name, pa.name AS pay_account_name,
         (SELECT count(*)::int FROM expense_lines l WHERE l.expense_id = x.id) AS line_count,
         (SELECT string_agg(l.name, ', ' ORDER BY l.id) FROM expense_lines l WHERE l.expense_id = x.id) AS item_names
    FROM expenses x LEFT JOIN users u1 ON u1.id = x.created_by LEFT JOIN users u2 ON u2.id = x.voided_by
    LEFT JOIN pay_accounts pa ON pa.id = x.pay_account_id`;

function filters(req: Request) {
  const params: unknown[] = [restoId(req)];
  const where = ['x.resto_id = $1'];
  const kind = kindOf(req.query.kind);
  if (kind) { params.push(kind); where.push(`x.kind = $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from))) { params.push(req.query.from); where.push(`x.expense_date >= $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to))) { params.push(req.query.to); where.push(`x.expense_date <= $${params.length}`); }
  if (req.query.status === 'void') where.push('x.voided_at IS NOT NULL');
  else if (req.query.status !== 'all') where.push('x.voided_at IS NULL');
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(x.number ILIKE $${params.length} OR x.supplier_name ILIKE $${params.length} OR EXISTS (SELECT 1 FROM expense_lines l WHERE l.expense_id = x.id AND l.name ILIKE $${params.length}))`);
  }
  return { params, where: where.join(' AND ') };
}

r.get('/expenses', async (req, res) => {
  const { params, where } = filters(req);
  const page = Math.max(1, Number(req.query.page) || 1), size = Math.min(200, Number(req.query.size) || 30);
  const agg = await one(`SELECT count(*)::int AS n, COALESCE(sum(x.total) FILTER (WHERE x.voided_at IS NULL), 0) AS sum FROM expenses x WHERE ${where}`, params);
  const data = await q(`${HEAD} WHERE ${where} ORDER BY x.expense_date DESC, x.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
  res.json({ data, total: agg.n, sum: agg.sum, page, size });
});

r.get('/expenses/:id', async (req, res) => {
  const x = await one(`${HEAD} WHERE x.id = $1 AND x.resto_id = $2`, [Number(req.params.id) || 0, restoId(req)]);
  if (!x) throw notFound('Belanja');
  const lines = await q(`SELECT * FROM expense_lines WHERE expense_id = $1 ORDER BY id`, [x.id]);
  const logs = await q(`SELECT id, user_name, user_role, action, detail, created_at FROM activity_logs WHERE entity = 'expense' AND entity_id = $1 ORDER BY created_at, id`, [x.id]);
  res.json({ ...x, lines, logs });
});

r.post('/expenses', only(...RESTO_ROLES), async (req, res) => {
  const rid = restoId(req);
  const kind = kindOf(req.body.kind);
  if (!kind) throw bad('Jenis belanja tidak valid');
  const date = String(req.body.expense_date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Isi tanggal belanja');
  const raw: any[] = req.body.lines ?? [];
  if (!raw.length) throw bad('Tambahkan minimal satu bahan');
  const out = await tx(async (c) => {
    const photo = await requirePhoto(c, rid, 'expense', req.body.receipt_photo_id, 'foto nota');
    const extra = await extraPhotos(c, rid, 'expense', req.body.extra_photo_ids);
    const acc = await one(`SELECT id, name FROM pay_accounts WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL`, [Number(req.body.pay_account_id) || 0, rid], c);
    if (!acc) throw bad('Pilih kas / rekening pembayaran');
    const items = new Map((await q(`SELECT * FROM expense_items WHERE resto_id = $1 AND kind = $2 AND deleted_at IS NULL`, [rid, kind], c)).map((x) => [x.id, x]));
    const lines = raw.map((l) => {
      const it = items.get(Number(l.item_id));
      if (!it) throw bad(`Bahan tidak ada di daftar ${KIND_LABEL[kind]}. Daftar bahan diatur oleh Central Admin.`);
      const qty = num(l.qty, `Jumlah ${it.name}`);
      if (qty <= 0) throw bad(`Jumlah ${it.name} harus lebih dari 0`);
      const amount = num(l.amount, `Harga ${it.name}`);
      return { it, qty, amount };
    });
    const total = lines.reduce((s, l) => s + l.amount, 0);
    if (total <= 0) throw bad('Total belanja harus lebih dari 0');
    const number = await nextNumber(c, 'expenses', kind === 'employee' ? 'BK' : 'BH', rid);
    const x = await one(
      `INSERT INTO expenses (resto_id, kind, number, expense_date, supplier_name, pay_account_id, total, receipt_photo_id, extra_photo_ids, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, number`,
      [rid, kind, number, date, String(req.body.supplier_name ?? '').trim() || null, acc.id, total, photo, extra, String(req.body.notes ?? '').trim() || null, req.s.userId],
      c,
    );
    for (const l of lines)
      await q(`INSERT INTO expense_lines (expense_id, item_id, name, unit, qty, amount, category, sub_category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [x.id, l.it.id, l.it.name, l.it.unit, l.qty, l.amount, l.it.category, l.it.sub_category], c);
    await log(req, { action: 'create', entity: 'expense', entityId: x.id, detail: `Mencatat ${KIND_LABEL[kind]} ${x.number}: ${lines.length} bahan, ${rpText(total)} dari ${acc.name}` }, c);
    return x;
  });
  res.status(201).json(out);
});

// Batalkan (salah input): tidak masuk jurnal lagi — Central Admin
r.post('/expenses/:id/void', only(...ADMIN_ROLES), async (req, res) => {
  await tx(async (c) => {
    const x = await one(`SELECT * FROM expenses WHERE id = $1 AND resto_id = $2 FOR UPDATE`, [Number(req.params.id) || 0, restoId(req)], c);
    if (!x) throw notFound('Belanja');
    if (x.voided_at) throw bad('Belanja ini sudah dibatalkan');
    const note = String(req.body.note ?? '').trim();
    if (!note) throw bad('Isi alasan pembatalan');
    await q(`UPDATE expenses SET voided_at = now(), voided_by = $2, void_note = $3 WHERE id = $1`, [x.id, req.s.userId, note], c);
    await log(req, { action: 'void', entity: 'expense', entityId: x.id, detail: `Membatalkan ${KIND_LABEL[x.kind as 'daily']} ${x.number}: ${note}` }, c);
  });
  res.json({ ok: true });
});

export default r;
