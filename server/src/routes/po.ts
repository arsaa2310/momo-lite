import { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import { one, q, tx } from '../lib/db.ts';
import { HttpError, bad, notFound, num } from '../lib/http.ts';
import { only, restoId } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';
import { nextNumber } from '../lib/numbers.ts';
import { extraPhotos, requirePhoto } from '../lib/uploads.ts';

// Alur PO versi lite (tanpa approval):
// 1. Purchasing membuat PO: pilih bahan → supplier (harga dari Central Admin, termurah dulu, boleh diubah).
//    Satu form boleh beberapa supplier → otomatis dipecah menjadi PO per supplier. Harga PO menjadi harga terbaru supplier itu.
// 2. Central Admin menetapkan K (kredit / hutang, PKH) atau T (tunai, PTH). K/T dari Central Admin terkunci untuk penerima.
//    Bila belum diatur, penerima memilih K/T saat barang pertama datang. Setelah barang datang hanya Central Admin yang bisa
//    mengubah K/T (status bayar kedatangan ikut berubah) selama hutangnya belum dilunasi.
// 3. Barang datang (boleh sebagian: PO-XXX-00001/1, /2, …) — wajib foto barang & foto nota. Kelebihan barang & harga nota yang
//    berbeda langsung dicatat dengan catatan wajib. PO selesai bila semua barang datang, atau sisa ditutup manual.
// 4. Hutang (K) dilunasi Central Admin: tanggal bayar & rekening → kolom Tanggal Bayar / Rekening di jurnal umum.
const r = Router();

const TERMS_LABEL = (t: string | null) => (t === 'credit' ? 'K (kredit)' : t === 'cash' ? 'T (tunai)' : 'belum ditentukan');
const qtyText = (n: unknown) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 3 });
const rpText = (n: unknown) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

const poLog = (req: Request, c: PoolClient, poId: number, action: string, detail: string) => log(req, { action, entity: 'po', entityId: poId, detail }, c);

// nilai hutang PO = kedatangan belum lunas (tidak dibatalkan) × faktor PPN/diskon
const DEBT_SQL = `COALESCE((SELECT round(sum(l.qty * l.unit_cost * rc.cost_factor), 2) FROM po_receipts rc JOIN po_receipt_lines l ON l.receipt_id = rc.id
                            WHERE rc.purchase_order_id = p.id AND NOT rc.paid AND rc.reversed_at IS NULL), 0)`;

r.get('/po', async (req, res) => {
  const rid = restoId(req);
  const params: unknown[] = [rid];
  const where = ['p.resto_id = $1'];
  const st = String(req.query.status ?? '');
  if (st === 'unset') where.push(`p.payment_terms IS NULL AND p.status IN ('open', 'partial')`);
  else if (st === 'debt') where.push(`p.payment_terms = 'credit' AND p.paid_date IS NULL AND ${DEBT_SQL} > 0`);
  else if (['open', 'partial', 'received', 'cancelled'].includes(st)) { params.push(st); where.push(`p.status = $${params.length}`); }
  if (req.query.supplier_id) { params.push(Number(req.query.supplier_id)); where.push(`p.supplier_id = $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from))) { params.push(`${req.query.from}T00:00:00+07:00`); where.push(`p.created_at >= $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to))) { params.push(`${req.query.to}T23:59:59.999+07:00`); where.push(`p.created_at <= $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(p.number ILIKE $${params.length} OR s.name ILIKE $${params.length})`); }
  const page = Math.max(1, Number(req.query.page) || 1), size = Math.min(200, Number(req.query.size) || 30);
  const base = `FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id WHERE ${where.join(' AND ')}`;
  const total = (await one(`SELECT count(*)::int n ${base}`, params)).n;
  const data = await q(
    `SELECT p.id, p.number, p.status, p.payment_terms, p.terms_by_central, p.created_at, p.expected_date, p.received_at, p.paid_date, p.notes,
            s.name AS supplier_name, u.name AS created_by_name,
            (SELECT sum(l.qty * l.unit_cost) FROM purchase_order_lines l WHERE l.purchase_order_id = p.id) AS total,
            (SELECT count(*)::int FROM purchase_order_lines l WHERE l.purchase_order_id = p.id) AS line_count,
            (SELECT round(100 * avg(LEAST(l.received_qty / NULLIF(l.qty, 0), 1)))::int FROM purchase_order_lines l WHERE l.purchase_order_id = p.id) AS received_pct,
            (SELECT count(*)::int FROM po_receipts rc WHERE rc.purchase_order_id = p.id AND rc.reversed_at IS NULL) AS receipt_count,
            ${DEBT_SQL} AS debt
     ${base.replace('WHERE', 'LEFT JOIN users u ON u.id = p.created_by WHERE')} ORDER BY p.created_at DESC, p.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    params,
  );
  const counts = await q(
    `SELECT status, count(*)::int n FROM purchase_orders WHERE resto_id = $1 GROUP BY status
     UNION ALL SELECT 'unset', count(*)::int FROM purchase_orders WHERE resto_id = $1 AND payment_terms IS NULL AND status IN ('open', 'partial')
     UNION ALL SELECT 'debt', count(*)::int FROM purchase_orders p WHERE p.resto_id = $1 AND p.payment_terms = 'credit' AND p.paid_date IS NULL AND ${DEBT_SQL} > 0`,
    [rid],
  );
  res.json({ data, total, page, size, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
});

async function ownedPo(req: Request, id: number, c?: PoolClient) {
  const p = await one(`SELECT * FROM purchase_orders WHERE id = $1 AND resto_id = $2 ${c ? 'FOR UPDATE' : ''}`, [id, restoId(req)], c);
  if (!p) throw notFound('PO');
  return p;
}

r.get('/po/:id', async (req, res) => {
  const p = await ownedPo(req, Number(req.params.id) || 0);
  const head = await one(
    `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, s.address AS supplier_address, s.contact_name AS supplier_contact, s.default_terms AS supplier_terms,
            r.name AS resto_name, r.code AS resto_code, r.address AS resto_address, r.phone AS resto_phone,
            u1.name AS created_by_name, u2.name AS closed_by_name, u3.name AS paid_by_name, pa.name AS paid_account_name, ${DEBT_SQL} AS debt
       FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id JOIN restos r ON r.id = p.resto_id
       LEFT JOIN users u1 ON u1.id = p.created_by LEFT JOIN users u2 ON u2.id = p.closed_by LEFT JOIN users u3 ON u3.id = p.paid_by
       LEFT JOIN pay_accounts pa ON pa.id = p.paid_account_id
      WHERE p.id = $1`,
    [p.id],
  );
  const lines = await q(
    `SELECT l.*, i.name, i.unit, i.category, i.sub_category FROM purchase_order_lines l JOIN items i ON i.id = l.item_id WHERE l.purchase_order_id = $1 ORDER BY l.id`, [p.id]);
  const receipts = await q(
    `SELECT rc.*, u1.name AS received_by_name, u2.name AS reversed_by_name, pa.name AS pay_account_name,
            COALESCE((SELECT json_agg(json_build_object('po_line_id', l.po_line_id, 'name', i.name, 'unit', i.unit, 'qty', l.qty, 'excess_qty', l.excess_qty,
                                                        'unit_cost', l.unit_cost, 'po_unit_cost', l.po_unit_cost) ORDER BY l.id)
                        FROM po_receipt_lines l JOIN purchase_order_lines pl ON pl.id = l.po_line_id JOIN items i ON i.id = pl.item_id WHERE l.receipt_id = rc.id), '[]') AS lines,
            (SELECT sum(l.qty * l.unit_cost) FROM po_receipt_lines l WHERE l.receipt_id = rc.id) * rc.cost_factor AS value
       FROM po_receipts rc LEFT JOIN users u1 ON u1.id = rc.received_by LEFT JOIN users u2 ON u2.id = rc.reversed_by
       LEFT JOIN pay_accounts pa ON pa.id = rc.pay_account_id
      WHERE rc.purchase_order_id = $1 ORDER BY rc.received_at, rc.id`,
    [p.id],
  );
  const logs = await q(`SELECT id, user_name, user_role, action, detail, created_at FROM activity_logs WHERE entity = 'po' AND entity_id = $1 ORDER BY created_at, id`, [p.id]);
  res.json({ ...head, lines, receipts, logs });
});

// ---------- Buat PO (dipecah per supplier) ----------
r.post('/po', only('purchasing', 'central'), async (req, res) => {
  const rid = restoId(req);
  const raw: any[] = req.body.lines ?? [];
  if (!raw.length) throw bad('Tambahkan minimal satu bahan');
  const expected = String(req.body.expected_date ?? '').trim() || null;
  if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw bad('Tanggal kirim tidak valid');
  const notes = String(req.body.notes ?? '').trim() || null;
  const made = await tx(async (c) => {
    const items = new Map((await q(`SELECT id, name, unit FROM items WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => [x.id, x]));
    const sups = new Map((await q(`SELECT id, name FROM suppliers WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => [x.id, x]));
    const links = new Map((await q(`SELECT si.supplier_id, si.item_id, si.price FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id WHERE s.resto_id = $1`, [rid], c))
      .map((x) => [`${x.supplier_id}:${x.item_id}`, x]));
    const bySupplier = new Map<number, { item_id: number; qty: number; unit_cost: number }[]>();
    for (const l of raw) {
      const it = items.get(Number(l.item_id));
      if (!it) throw bad('Ada bahan yang tidak ada di master data. Bahan diatur oleh Central Admin.');
      const sup = sups.get(Number(l.supplier_id));
      if (!sup) throw bad(`Pilih supplier untuk "${it.name}"`);
      const link = links.get(`${sup.id}:${it.id}`);
      if (!link) throw bad(`${sup.name} tidak terdaftar sebagai supplier "${it.name}". Hubungi Central Admin untuk menambahkannya di sheet Harga Supplier.`);
      const qty = num(l.qty, `Jumlah ${it.name}`);
      if (qty <= 0) throw bad(`Jumlah ${it.name} harus lebih dari 0`);
      const cost = l.unit_cost === undefined || l.unit_cost === null || l.unit_cost === '' ? Number(link.price ?? 0) : num(l.unit_cost, `Harga ${it.name}`);
      bySupplier.set(sup.id, [...(bySupplier.get(sup.id) ?? []), { item_id: it.id, qty, unit_cost: cost }]);
    }
    const out: { id: number; number: string }[] = [];
    for (const [supplierId, ls] of bySupplier) {
      const po = await one(
        `INSERT INTO purchase_orders (resto_id, number, supplier_id, notes, expected_date, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, number`,
        [rid, await nextNumber(c, 'purchase_orders', 'PO', rid), supplierId, notes, expected, req.s.userId], c);
      for (const l of ls) {
        await q(`INSERT INTO purchase_order_lines (purchase_order_id, item_id, qty, unit_cost) VALUES ($1,$2,$3,$4)`, [po.id, l.item_id, l.qty, l.unit_cost], c);
        // harga PO terbaru menjadi harga supplier
        if (l.unit_cost > 0) await q(`UPDATE supplier_items SET price = $3, updated_at = now() WHERE supplier_id = $1 AND item_id = $2`, [supplierId, l.item_id, l.unit_cost], c);
      }
      const total = ls.reduce((s, l) => s + l.qty * l.unit_cost, 0);
      await poLog(req, c, po.id, 'create', `Membuat ${po.number} ke ${sups.get(supplierId)!.name}: ${ls.length} bahan, ${rpText(total)}`);
      out.push(po);
    }
    return out;
  });
  res.status(201).json({ purchase_orders: made });
});

// ---------- Batalkan PO (belum ada barang datang) ----------
r.post('/po/:id/cancel', only('purchasing', 'central'), async (req, res) => {
  await tx(async (c) => {
    const p = await ownedPo(req, Number(req.params.id) || 0, c);
    if (p.status !== 'open') throw bad('Hanya PO yang belum ada barang datang yang bisa dibatalkan. Untuk PO diterima sebagian, gunakan Tutup sisa PO.');
    if (req.s.role === 'purchasing' && p.created_by !== req.s.userId) throw new HttpError(403, 'Hanya pembuat PO atau Central Admin yang bisa membatalkan');
    const note = String(req.body.note ?? '').trim();
    if (!note) throw bad('Isi alasan pembatalan');
    await q(`UPDATE purchase_orders SET status = 'cancelled', closed_by = $2, close_note = $3 WHERE id = $1`, [p.id, req.s.userId, note], c);
    await poLog(req, c, p.id, 'cancel', `Membatalkan ${p.number}: ${note}`);
  });
  res.json({ ok: true });
});

// ---------- K/T, jatuh tempo (Central Admin) ----------
r.put('/po/:id/terms', only('central'), async (req, res) => {
  await tx(async (c) => {
    const p = await ownedPo(req, Number(req.params.id) || 0, c);
    if (p.status === 'cancelled') throw bad('PO ini sudah dibatalkan');
    const terms = req.body.payment_terms === 'credit' ? 'credit' : req.body.payment_terms === 'cash' ? 'cash' : null;
    if (!terms) throw bad('Pilih K (kredit / hutang) atau T (tunai)');
    const receipts = await q(`SELECT * FROM po_receipts WHERE purchase_order_id = $1 AND reversed_at IS NULL ORDER BY id FOR UPDATE`, [p.id], c);
    if (terms !== p.payment_terms || !p.terms_by_central) {
      const changed = receipts.length > 0 && terms !== p.payment_terms;
      if (changed) {
        if (p.paid_date) throw bad('Hutang PO ini sudah dilunasi. Batalkan pelunasan dulu bila K/T ingin diubah.');
        // T: kedatangan yang sudah dicatat dianggap dibayar dari kas / rekening yang dipilih
        const acc = terms === 'cash' ? await payAccount(c, restoId(req), req.body.pay_account_id) : null;
        await q(`UPDATE po_receipts SET paid = $2, pay_account_id = $3 WHERE purchase_order_id = $1 AND reversed_at IS NULL`, [p.id, terms === 'cash', acc?.id ?? null], c);
      }
      await q(`UPDATE purchase_orders SET payment_terms = $2, terms_by_central = true WHERE id = $1`, [p.id, terms], c);
      await poLog(req, c, p.id, 'terms', `Pembayaran ${p.number}: ${TERMS_LABEL(p.payment_terms)} → ${TERMS_LABEL(terms)}${changed ? ' (status bayar kedatangan yang sudah dicatat ikut diubah)' : ''}`);
    }
    if (req.body.due_date !== undefined) {
      const due = String(req.body.due_date ?? '').trim() || null;
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw bad('Tanggal jatuh tempo tidak valid');
      if (due !== (p.due_date ?? null)) {
        await q(`UPDATE purchase_orders SET due_date = $2 WHERE id = $1`, [p.id, due], c);
        await poLog(req, c, p.id, 'terms', `Jatuh tempo ${p.number}: ${p.due_date ?? '—'} → ${due ?? '—'}`);
      }
    }
  });
  res.json({ ok: true });
});

async function payAccount(c: PoolClient, rid: number, id: unknown) {
  const a = await one(`SELECT id, name FROM pay_accounts WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL`, [Number(id) || 0, rid], c);
  if (!a) throw Object.assign(bad('Pilih kas / rekening pembayaran'), { code: 'ACCOUNT' });
  return a;
}

// ---------- Terima barang (sebagian / penuh) ----------
r.post('/po/:id/receive', only('purchasing', 'central'), async (req, res) => {
  const rid = restoId(req);
  const out = await tx(async (c) => {
    const p = await ownedPo(req, Number(req.params.id) || 0, c);
    if (!['open', 'partial'].includes(p.status)) throw bad('PO ini sudah selesai atau dibatalkan');
    const goods = await requirePhoto(c, rid, 'receiving', req.body.goods_photo_id, 'foto barang yang datang');
    const nota = await requirePhoto(c, rid, 'receiving', req.body.receipt_photo_id, 'foto nota / struk dari supplier');
    const extra = await extraPhotos(c, rid, 'receiving', req.body.extra_photo_ids);

    const lines = await q(`SELECT l.*, i.name, i.unit FROM purchase_order_lines l JOIN items i ON i.id = l.item_id WHERE l.purchase_order_id = $1 ORDER BY l.id FOR UPDATE OF l`, [p.id], c);
    const input: Record<string, unknown> = req.body.received ?? {};
    const prices: Record<string, unknown> = req.body.prices ?? {};
    const rows = lines.map((l) => {
      const v = input[l.id];
      const qty = round3(v === undefined || v === '' || v === null ? 0 : num(v, `Jumlah datang ${l.name}`));
      const remaining = Math.max(0, round3(Number(l.qty) - Number(l.received_qty)));
      const pv = prices[l.id];
      const nota = pv === undefined || pv === '' || pv === null ? Number(l.unit_cost) : num(pv, `Harga nota ${l.name}`);
      return { line: l, qty, excess: round3(Math.max(0, qty - remaining)), cost: nota, diff: Math.abs(nota - Number(l.unit_cost)) > 0.005 };
    }).filter((x) => x.qty > 0);
    if (!rows.length) throw bad('Isi jumlah barang yang datang');

    const excessNote = String(req.body.excess_note ?? '').trim();
    if (rows.some((x) => x.excess > 0) && !excessNote)
      throw Object.assign(bad('Ada barang yang melebihi pesanan. Isi catatan kelebihan barang.'), { code: 'EXCESS_NOTE' });
    const priceNote = String(req.body.price_note ?? '').trim();
    if (rows.some((x) => x.diff) && !priceNote)
      throw Object.assign(bad('Harga nota berbeda dari harga PO. Isi catatan selisih harga.'), { code: 'PRICE_NOTE' });

    // K/T: dari Central Admin (terkunci) atau dipilih penerima saat barang pertama datang
    let terms = p.payment_terms as string | null;
    if (!p.terms_by_central) {
      const chosen = req.body.payment_terms === 'credit' ? 'credit' : req.body.payment_terms === 'cash' ? 'cash' : null;
      const hasReceipts = await one(`SELECT 1 AS x FROM po_receipts WHERE purchase_order_id = $1 AND reversed_at IS NULL`, [p.id], c);
      if (!terms || (!hasReceipts && chosen)) {
        if (!chosen) throw Object.assign(bad('Pilih pembayaran: K (kredit / hutang) atau T (tunai)'), { code: 'TERMS' });
        if (chosen !== terms) {
          await q(`UPDATE purchase_orders SET payment_terms = $2 WHERE id = $1`, [p.id, chosen], c);
          await poLog(req, c, p.id, 'terms', `Pembayaran ${p.number} dipilih penerima: ${TERMS_LABEL(chosen)}`);
        }
        terms = chosen;
      }
    }
    const paid = terms === 'cash';
    const acc = paid ? await payAccount(c, rid, req.body.pay_account_id) : null;

    // PPN & diskon nota (opsional) masuk ke harga modal: harga × faktor
    const ppn = Math.max(0, Number(req.body.ppn) || 0);
    const discount = Math.max(0, Number(req.body.discount) || 0);
    const gross = rows.reduce((s, x) => s + x.qty * x.cost, 0);
    if (discount > gross) throw bad('Diskon melebihi nilai nota');
    const factor = gross > 0 ? (gross - discount + ppn) / gross : 1;

    const n = (await one(`SELECT count(*)::int + 1 AS n FROM po_receipts WHERE purchase_order_id = $1`, [p.id], c)).n;
    const rc = await one(
      `INSERT INTO po_receipts (purchase_order_id, number, received_by, goods_photo_id, receipt_photo_id, extra_photo_ids, paid, pay_account_id,
                                ppn, discount, cost_factor, notes, excess_note, price_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, number`,
      [p.id, `${p.number}/${n}`, req.s.userId, goods, nota, extra, paid, acc?.id ?? null, ppn, discount, factor,
       String(req.body.notes ?? '').trim() || null, rows.some((x) => x.excess > 0) ? excessNote : null, rows.some((x) => x.diff) ? priceNote : null],
      c,
    );
    for (const x of rows) {
      await q(`INSERT INTO po_receipt_lines (receipt_id, po_line_id, qty, excess_qty, unit_cost, po_unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`,
        [rc.id, x.line.id, x.qty, x.excess, x.cost, x.line.unit_cost], c);
      await q(`UPDATE purchase_order_lines SET received_qty = received_qty + $2 WHERE id = $1`, [x.line.id, x.qty], c);
    }
    const complete = await refreshStatus(c, p.id);
    const value = gross * factor;
    const parts = rows.map((x) => `${x.line.name} ${qtyText(x.qty)} ${x.line.unit}${x.excess > 0 ? ` (lebih ${qtyText(x.excess)})` : ''}${x.diff ? ` harga ${rpText(x.line.unit_cost)} → ${rpText(x.cost)}` : ''}`);
    await poLog(req, c, p.id, 'receive',
      `Menerima ${rc.number}: ${parts.join(', ')} — ${rpText(value)}, ${paid ? `T lunas dari ${acc!.name}` : 'K (hutang)'}${complete ? '. PO selesai.' : ''}`);
    return { id: rc.id, number: rc.number, complete };
  });
  res.status(201).json(out);
});

// Semua barang sudah datang → selesai; ada yang datang → diterima sebagian; belum ada → menunggu
async function refreshStatus(c: PoolClient, poId: number) {
  const s = await one(
    `SELECT bool_and(received_qty >= qty) AS done, bool_or(received_qty > 0) AS any FROM purchase_order_lines WHERE purchase_order_id = $1`, [poId], c);
  const status = s.done ? 'received' : s.any ? 'partial' : 'open';
  await q(`UPDATE purchase_orders SET status = $2, received_at = CASE WHEN $2 = 'received' THEN COALESCE(received_at, now()) ELSE NULL END WHERE id = $1 AND status <> 'cancelled'`,
    [poId, status], c);
  return status === 'received';
}

// ---------- Tutup sisa PO (sisa dianggap tidak dikirim) ----------
r.post('/po/:id/close', only('purchasing', 'central'), async (req, res) => {
  await tx(async (c) => {
    const p = await ownedPo(req, Number(req.params.id) || 0, c);
    if (p.status !== 'partial') throw bad('Tutup sisa hanya untuk PO yang diterima sebagian. PO yang belum ada barang datang bisa dibatalkan.');
    const note = String(req.body.note ?? '').trim();
    if (!note) throw bad('Isi alasan menutup sisa PO');
    const left = await q(`SELECT i.name, i.unit, l.qty - l.received_qty AS left FROM purchase_order_lines l JOIN items i ON i.id = l.item_id
                           WHERE l.purchase_order_id = $1 AND l.received_qty < l.qty`, [p.id], c);
    await q(`UPDATE purchase_orders SET status = 'received', received_at = now(), closed_by = $2, close_note = $3 WHERE id = $1`, [p.id, req.s.userId, note], c);
    await poLog(req, c, p.id, 'close', `Menutup sisa ${p.number} (${left.map((x) => `${x.name} ${qtyText(x.left)} ${x.unit}`).join(', ')} tidak dikirim): ${note}`);
  });
  res.json({ ok: true });
});

// ---------- Batalkan satu kedatangan (salah input) — Central Admin ----------
r.post('/po/:id/receipts/:rid/reverse', only('central'), async (req, res) => {
  await tx(async (c) => {
    const p = await ownedPo(req, Number(req.params.id) || 0, c);
    const rc = await one(`SELECT * FROM po_receipts WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE`, [Number(req.params.rid) || 0, p.id], c);
    if (!rc) throw notFound('Kedatangan');
    if (rc.reversed_at) throw bad('Kedatangan ini sudah dibatalkan');
    if (!rc.paid && p.paid_date) throw bad('Hutang PO ini sudah dilunasi. Batalkan pelunasan dulu.');
    const note = String(req.body.note ?? '').trim();
    if (!note) throw bad('Isi alasan pembatalan');
    for (const l of await q(`SELECT * FROM po_receipt_lines WHERE receipt_id = $1`, [rc.id], c))
      await q(`UPDATE purchase_order_lines SET received_qty = GREATEST(0, received_qty - $2) WHERE id = $1`, [l.po_line_id, l.qty], c);
    await q(`UPDATE po_receipts SET reversed_at = now(), reversed_by = $2, reverse_note = $3 WHERE id = $1`, [rc.id, req.s.userId, note], c);
    // PO yang ditutup manual dibuka lagi bila kedatangannya dibatalkan
    await q(`UPDATE purchase_orders SET closed_by = NULL, close_note = NULL WHERE id = $1 AND status = 'received'`, [p.id], c);
    await refreshStatus(c, p.id);
    await poLog(req, c, p.id, 'reverse', `Membatalkan kedatangan ${rc.number}: ${note}`);
  });
  res.json({ ok: true });
});

// ---------- Pelunasan hutang (K) — Central Admin ----------
r.post('/po/:id/pay', only('central'), async (req, res) => {
  const rid = restoId(req);
  await tx(async (c) => {
    const p = await ownedPo(req, Number(req.params.id) || 0, c);
    if (p.payment_terms !== 'credit') throw bad('Pelunasan hanya untuk PO kredit (K)');
    if (p.paid_date) throw bad('Hutang PO ini sudah dilunasi');
    const debt = Number((await one(`SELECT ${DEBT_SQL} AS d FROM purchase_orders p WHERE p.id = $1`, [p.id], c)).d);
    if (debt <= 0) throw bad('Belum ada hutang: barang PO ini belum datang');
    const date = String(req.body.paid_date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Isi tanggal bayar');
    const acc = await payAccount(c, rid, req.body.pay_account_id);
    const photo = req.body.photo_id ? await requirePhoto(c, rid, 'payment', req.body.photo_id, 'bukti bayar yang valid') : null;
    await q(`UPDATE purchase_orders SET paid_date = $2, paid_account_id = $3, paid_by = $4, paid_photo_id = $5 WHERE id = $1`, [p.id, date, acc.id, req.s.userId, photo], c);
    await poLog(req, c, p.id, 'pay', `Melunasi hutang ${p.number} ${rpText(debt)} tanggal ${date} dari ${acc.name}`);
  });
  res.json({ ok: true });
});
r.delete('/po/:id/pay', only('central'), async (req, res) => {
  await tx(async (c) => {
    const p = await ownedPo(req, Number(req.params.id) || 0, c);
    if (!p.paid_date) throw bad('PO ini belum dilunasi');
    await q(`UPDATE purchase_orders SET paid_date = NULL, paid_account_id = NULL, paid_by = NULL, paid_photo_id = NULL WHERE id = $1`, [p.id], c);
    await poLog(req, c, p.id, 'pay', `Membatalkan pelunasan hutang ${p.number} (sebelumnya ${p.paid_date})`);
  });
  res.json({ ok: true });
});

export default r;
