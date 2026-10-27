import { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import ExcelJS from 'exceljs';
import { one, q, tx } from '../lib/db.ts';
import { HttpError, bad, notFound } from '../lib/http.ts';
import { ADMIN_ROLES, only, restoId } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';
import { addTableSheet, loadWorkbook, parseNumber, readSheet, sendWorkbook, type Col } from '../lib/excel.ts';

// Master data resto diisi Central Admin / Owner lewat template Excel (unduh template → isi → impor).
// Impor = tambah / perbarui berdasarkan nama (tidak membedakan huruf besar-kecil); baris yang tidak ada di file tidak dihapus.
// Menghapus dilakukan per baris di halaman Master Data.
const r = Router();

// Kategori bawaan belanja (sama dengan momo): dipakai bila kolom kategori dikosongkan
export const EXPENSE_CAT = {
  employee: { category: '3.6 Biaya Natura', sub_category: 'Masak Karyawan' },
  daily: { category: '2.1 Biaya Bahan Baku Produksi', sub_category: 'Bahan Harian' },
};
const KIND_TEXT: Record<string, 'daily' | 'employee'> = { harian: 'daily', 'belanja harian': 'daily', daily: 'daily', karyawan: 'employee', 'belanja karyawan': 'employee', employee: 'employee' };
const TERMS_TEXT: Record<string, 'cash' | 'credit'> = { t: 'cash', tunai: 'cash', cash: 'cash', k: 'credit', kredit: 'credit', credit: 'credit', hutang: 'credit' };

const SHEETS = {
  items: { name: 'Bahan PO', cols: [
    { header: 'Nama Bahan', key: 'name', required: true, width: 32 },
    { header: 'Satuan', key: 'unit', required: true, width: 12, note: 'mis. kg, gram, liter, pcs, pack, ikat' },
    { header: 'Kategori', key: 'category', width: 30, note: 'Kolom Kategori di jurnal umum, mis. 2.1 Biaya Bahan Baku Produksi' },
    { header: 'Sub Kategori', key: 'sub_category', width: 22, note: 'mis. Daging, Sayur, Bumbu, Minuman' },
  ] as Col[] },
  suppliers: { name: 'Supplier', cols: [
    { header: 'Nama Supplier', key: 'name', required: true, width: 30 },
    { header: 'Kontak', key: 'contact_name', width: 20 },
    { header: 'Telepon', key: 'phone', width: 16 },
    { header: 'Alamat', key: 'address', width: 36 },
    { header: 'Termin Default (K/T)', key: 'terms', width: 20, list: '"K,T"', note: 'K = kredit / hutang, T = tunai. Dipakai sebagai usulan K/T saat PO dibuat.' },
  ] as Col[] },
  prices: { name: 'Harga Supplier', cols: [
    { header: 'Supplier', key: 'supplier', required: true, width: 30, list: "'Supplier'!$A$2:$A$2000", note: 'Nama supplier persis seperti di sheet Supplier' },
    { header: 'Bahan', key: 'item', required: true, width: 32, list: "'Bahan PO'!$A$2:$A$2000", note: 'Nama bahan persis seperti di sheet Bahan PO' },
    { header: 'Harga', key: 'price', type: 'money', width: 16, note: 'Harga per satuan bahan. Boleh kosong.' },
  ] as Col[] },
  expenseItems: { name: 'Bahan Belanja', cols: [
    { header: 'Jenis', key: 'kind', required: true, width: 12, list: '"Harian,Karyawan"', note: 'Harian = belanja harian (HPP), Karyawan = belanja karyawan (beban)' },
    { header: 'Nama Bahan', key: 'name', required: true, width: 30 },
    { header: 'Satuan', key: 'unit', width: 12 },
    { header: 'Harga Default', key: 'default_price', type: 'money', width: 16 },
    { header: 'Kategori', key: 'category', width: 30, note: `Kosong = ${EXPENSE_CAT.daily.category} (harian) / ${EXPENSE_CAT.employee.category} (karyawan)` },
    { header: 'Sub Kategori', key: 'sub_category', width: 22, note: `Kosong = ${EXPENSE_CAT.daily.sub_category} / ${EXPENSE_CAT.employee.sub_category}` },
  ] as Col[] },
  accounts: { name: 'Rekening', cols: [
    { header: 'Nama Kas / Rekening', key: 'name', required: true, width: 36, note: 'mis. Kas tunai, BCA 1234567890 a.n. Resto' },
  ] as Col[] },
};

// Kategori bawaan pengeluaran lain (saran di form; boleh diketik bebas)
export const OTHER_CATEGORIES = ['Beban Listrik', 'Beban Air', 'Beban Gas', 'Beban Internet & Telepon', 'Beban Sewa', 'Beban Perbaikan & Pemeliharaan',
  'Beban Kebersihan', 'Beban Transportasi', 'Beban Pemasaran', 'Beban Perlengkapan', 'Beban Administrasi & Pajak', 'Beban Lain-lain'];

// ---------- Data untuk form (semua pengguna resto) ----------
r.get('/master/options', async (req, res) => {
  const rid = restoId(req);
  const [items, suppliers, expenseItems, accounts, methods, resto, usedCats] = await Promise.all([
    q(`SELECT i.id, i.name, i.unit, i.category, i.sub_category,
              COALESCE((SELECT json_agg(json_build_object('supplier_id', s.id, 'name', s.name, 'price', si.price) ORDER BY si.price NULLS LAST, s.name)
                          FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id AND s.deleted_at IS NULL WHERE si.item_id = i.id), '[]') AS suppliers
         FROM items i WHERE i.resto_id = $1 AND i.deleted_at IS NULL ORDER BY i.name`, [rid]),
    q(`SELECT id, name, default_terms, phone FROM suppliers WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY name`, [rid]),
    q(`SELECT id, kind, name, unit, default_price, category, sub_category FROM expense_items WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY name`, [rid]),
    q(`SELECT id, name FROM pay_accounts WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY id`, [rid]),
    q(`SELECT m.id, m.name, m.pay_account_id, pa.name AS pay_account_name FROM revenue_methods m LEFT JOIN pay_accounts pa ON pa.id = m.pay_account_id
        WHERE m.resto_id = $1 AND m.deleted_at IS NULL ORDER BY m.sort, m.id`, [rid]),
    one(`SELECT shift_names FROM restos WHERE id = $1`, [rid]),
    q(`SELECT DISTINCT l.category FROM other_expense_lines l JOIN other_expenses x ON x.id = l.expense_id WHERE x.resto_id = $1`, [rid]),
  ]);
  res.json({
    items, suppliers, expense_items: expenseItems, accounts, revenue_methods: methods, shifts: resto?.shift_names ?? ['Harian'],
    other_categories: [...new Set([...OTHER_CATEGORIES, ...usedCats.map((x) => x.category)])].sort(),
  });
});

// ---------- Daftar master (Central Admin) ----------
r.get('/master/items', only(...ADMIN_ROLES), async (req, res) => {
  res.json(await q(
    `SELECT i.*, (SELECT count(*)::int FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id AND s.deleted_at IS NULL WHERE si.item_id = i.id) AS supplier_count,
            (SELECT min(si.price) FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id AND s.deleted_at IS NULL WHERE si.item_id = i.id) AS min_price
       FROM items i WHERE i.resto_id = $1 AND i.deleted_at IS NULL ORDER BY i.name`, [restoId(req)]));
});
r.get('/master/suppliers', only(...ADMIN_ROLES), async (req, res) => {
  res.json(await q(
    `SELECT s.*, (SELECT count(*)::int FROM supplier_items si JOIN items i ON i.id = si.item_id AND i.deleted_at IS NULL WHERE si.supplier_id = s.id) AS item_count
       FROM suppliers s WHERE s.resto_id = $1 AND s.deleted_at IS NULL ORDER BY s.name`, [restoId(req)]));
});
r.get('/master/prices', only(...ADMIN_ROLES), async (req, res) => {
  res.json(await q(
    `SELECT si.supplier_id, si.item_id, si.price, si.updated_at, s.name AS supplier_name, i.name AS item_name, i.unit
       FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id AND s.deleted_at IS NULL JOIN items i ON i.id = si.item_id AND i.deleted_at IS NULL
      WHERE s.resto_id = $1 ORDER BY s.name, i.name`, [restoId(req)]));
});
r.get('/master/expense-items', only(...ADMIN_ROLES), async (req, res) => {
  res.json(await q(`SELECT * FROM expense_items WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY kind, name`, [restoId(req)]));
});
r.get('/master/accounts', only(...ADMIN_ROLES), async (req, res) => {
  res.json(await q(`SELECT * FROM pay_accounts WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY id`, [restoId(req)]));
});
r.get('/master/revenue-methods', only(...ADMIN_ROLES), async (req, res) => {
  res.json(await q(
    `SELECT m.*, pa.name AS pay_account_name FROM revenue_methods m LEFT JOIN pay_accounts pa ON pa.id = m.pay_account_id
      WHERE m.resto_id = $1 AND m.deleted_at IS NULL ORDER BY m.sort, m.id`, [restoId(req)]));
});

const TABLES: Record<string, { table: string; label: string }> = {
  items: { table: 'items', label: 'bahan PO' },
  suppliers: { table: 'suppliers', label: 'supplier' },
  'expense-items': { table: 'expense_items', label: 'bahan belanja' },
  accounts: { table: 'pay_accounts', label: 'rekening' },
  'revenue-methods': { table: 'revenue_methods', label: 'metode pendapatan' },
};
r.delete('/master/:kind/:id', only(...ADMIN_ROLES), async (req, res) => {
  const rid = restoId(req);
  const t = TABLES[String(req.params.kind)];
  if (!t) throw notFound('Data');
  const row = await one(`UPDATE ${t.table} SET deleted_at = now() WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL RETURNING name`, [Number(req.params.id) || 0, rid]);
  if (!row) throw notFound('Data');
  await log(req, { action: 'delete', entity: 'master', entityId: Number(req.params.id), detail: `Menghapus ${t.label} ${row.name}` });
  res.status(204).end();
});
r.delete('/master/prices/:supplierId/:itemId', only(...ADMIN_ROLES), async (req, res) => {
  const row = await one(
    `DELETE FROM supplier_items si USING suppliers s, items i WHERE si.supplier_id = $1 AND si.item_id = $2 AND s.id = si.supplier_id AND i.id = si.item_id AND s.resto_id = $3
     RETURNING s.name AS supplier, i.name AS item`, [Number(req.params.supplierId) || 0, Number(req.params.itemId) || 0, restoId(req)]);
  if (!row) throw notFound('Harga');
  await log(req, { action: 'delete', entity: 'master', detail: `Melepas bahan ${row.item} dari supplier ${row.supplier}` });
  res.status(204).end();
});

// ---------- Input manual satu per satu (Central Admin) ----------
// Sama aturannya dengan impor Excel: nama unik per resto, satuan bahan PO tidak bisa diubah setelah pernah dipesan.
const text = (v: unknown) => String(v ?? '').trim();
const textOrNull = (v: unknown) => text(v) || null;
const rpText = (n: unknown) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;
function priceOf(v: unknown, label = 'Harga') {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad(`${label} tidak valid`);
  return n;
}
async function assertUniqueName(c: PoolClient, table: string, rid: number, name: string, id: number | null, label: string, extra = '', params: unknown[] = []) {
  const dup = await one(`SELECT 1 AS x FROM ${table} WHERE resto_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND id <> $3 ${extra}`, [rid, name, id ?? 0, ...params], c);
  if (dup) throw bad(`${label} "${name}" sudah ada`);
}

// Detail untuk form ubah: bahan + supplier yang menyediakannya / supplier + bahannya
r.get('/master/items/:id', only(...ADMIN_ROLES), async (req, res) => {
  const it = await one(`SELECT * FROM items WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL`, [Number(req.params.id) || 0, restoId(req)]);
  if (!it) throw notFound('Bahan');
  const prices = await q(`SELECT si.supplier_id, si.price, s.name AS supplier_name FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id AND s.deleted_at IS NULL
                           WHERE si.item_id = $1 ORDER BY s.name`, [it.id]);
  const used = !!(await one(`SELECT 1 AS x FROM purchase_order_lines WHERE item_id = $1 LIMIT 1`, [it.id]));
  res.json({ ...it, prices, used });
});
r.get('/master/suppliers/:id', only(...ADMIN_ROLES), async (req, res) => {
  const s = await one(`SELECT * FROM suppliers WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL`, [Number(req.params.id) || 0, restoId(req)]);
  if (!s) throw notFound('Supplier');
  const prices = await q(`SELECT si.item_id, si.price, i.name AS item_name, i.unit FROM supplier_items si JOIN items i ON i.id = si.item_id AND i.deleted_at IS NULL
                           WHERE si.supplier_id = $1 ORDER BY i.name`, [s.id]);
  res.json({ ...s, prices });
});

// Ganti daftar pasangan supplier–bahan dari sisi satu bahan / satu supplier
async function replacePrices(c: PoolClient, rid: number, side: 'item' | 'supplier', id: number, raw: unknown) {
  const rows: any[] = Array.isArray(raw) ? raw : [];
  const other = side === 'item' ? 'supplier' : 'item';
  const valid = new Set((await q(`SELECT id FROM ${other === 'item' ? 'items' : 'suppliers'} WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => x.id));
  const seen = new Set<number>();
  const list = rows.map((x) => {
    const oid = Number(x[`${other}_id`]) || 0;
    if (!valid.has(oid)) throw bad(other === 'item' ? 'Pilih bahan yang valid' : 'Pilih supplier yang valid');
    if (seen.has(oid)) throw bad(other === 'item' ? 'Ada bahan yang dipilih dua kali' : 'Ada supplier yang dipilih dua kali');
    seen.add(oid);
    return { oid, price: priceOf(x.price) };
  });
  const col = side === 'item' ? 'item_id' : 'supplier_id', ocol = side === 'item' ? 'supplier_id' : 'item_id';
  await q(`DELETE FROM supplier_items WHERE ${col} = $1 AND NOT (${ocol} = ANY($2::bigint[]))`, [id, list.map((x) => x.oid)], c);
  for (const x of list)
    await q(`INSERT INTO supplier_items (${col}, ${ocol}, price) VALUES ($1,$2,$3)
             ON CONFLICT (supplier_id, item_id) DO UPDATE SET price = EXCLUDED.price, updated_at = CASE WHEN supplier_items.price IS DISTINCT FROM EXCLUDED.price THEN now() ELSE supplier_items.updated_at END`,
      [id, x.oid, x.price], c);
  return list.length;
}

async function saveItem(req: Request, id: number | null) {
  const rid = restoId(req);
  const d = { name: text(req.body.name), unit: text(req.body.unit), category: textOrNull(req.body.category), sub_category: textOrNull(req.body.sub_category) };
  if (!d.name) throw bad('Isi nama bahan');
  if (!d.unit) throw bad('Isi satuan');
  return tx(async (c) => {
    await assertUniqueName(c, 'items', rid, d.name, id, 'Bahan');
    let row;
    if (id) {
      const cur = await one(`SELECT * FROM items WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL FOR UPDATE`, [id, rid], c);
      if (!cur) throw notFound('Bahan');
      if (cur.unit.toLowerCase() !== d.unit.toLowerCase() && (await one(`SELECT 1 AS x FROM purchase_order_lines WHERE item_id = $1 LIMIT 1`, [id], c)))
        throw bad(`Satuan "${cur.name}" tidak bisa diubah karena sudah pernah dipesan. Buat bahan baru bila satuannya berbeda.`);
      row = await one(`UPDATE items SET name = $2, unit = $3, category = $4, sub_category = $5 WHERE id = $1 RETURNING *`, [id, d.name, d.unit, d.category, d.sub_category], c);
    } else row = await one(`INSERT INTO items (resto_id, name, unit, category, sub_category) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [rid, d.name, d.unit, d.category, d.sub_category], c);
    const n = req.body.prices !== undefined ? await replacePrices(c, rid, 'item', row.id, req.body.prices) : null;
    await log(req, { action: id ? 'update' : 'create', entity: 'master', entityId: row.id, detail: `${id ? 'Mengubah' : 'Menambah'} bahan PO ${d.name} (${d.unit})${n != null ? `, ${n} supplier` : ''}` }, c);
    return row;
  });
}
r.post('/master/items', only(...ADMIN_ROLES), async (req, res) => res.status(201).json(await saveItem(req, null)));
r.put('/master/items/:id', only(...ADMIN_ROLES), async (req, res) => res.json(await saveItem(req, Number(req.params.id) || 0)));

async function saveSupplier(req: Request, id: number | null) {
  const rid = restoId(req);
  const terms = req.body.default_terms === 'credit' ? 'credit' : req.body.default_terms === 'cash' ? 'cash' : null;
  const d = { name: text(req.body.name), contact_name: textOrNull(req.body.contact_name), phone: textOrNull(req.body.phone), address: textOrNull(req.body.address), default_terms: terms };
  if (!d.name) throw bad('Isi nama supplier');
  return tx(async (c) => {
    await assertUniqueName(c, 'suppliers', rid, d.name, id, 'Supplier');
    const row = id
      ? await one(`UPDATE suppliers SET name = $3, contact_name = $4, phone = $5, address = $6, default_terms = $7 WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL RETURNING *`,
          [id, rid, d.name, d.contact_name, d.phone, d.address, d.default_terms], c)
      : await one(`INSERT INTO suppliers (resto_id, name, contact_name, phone, address, default_terms) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [rid, d.name, d.contact_name, d.phone, d.address, d.default_terms], c);
    if (!row) throw notFound('Supplier');
    const n = req.body.prices !== undefined ? await replacePrices(c, rid, 'supplier', row.id, req.body.prices) : null;
    await log(req, { action: id ? 'update' : 'create', entity: 'master', entityId: row.id, detail: `${id ? 'Mengubah' : 'Menambah'} supplier ${d.name}${n != null ? `, ${n} bahan` : ''}` }, c);
    return row;
  });
}
r.post('/master/suppliers', only(...ADMIN_ROLES), async (req, res) => res.status(201).json(await saveSupplier(req, null)));
r.put('/master/suppliers/:id', only(...ADMIN_ROLES), async (req, res) => res.json(await saveSupplier(req, Number(req.params.id) || 0)));

// satu pasangan supplier–bahan (tambah / ubah harga)
r.put('/master/prices', only(...ADMIN_ROLES), async (req, res) => {
  const rid = restoId(req);
  const s = await one(`SELECT id, name FROM suppliers WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL`, [Number(req.body.supplier_id) || 0, rid]);
  if (!s) throw bad('Pilih supplier');
  const it = await one(`SELECT id, name FROM items WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL`, [Number(req.body.item_id) || 0, rid]);
  if (!it) throw bad('Pilih bahan');
  const price = priceOf(req.body.price);
  await q(`INSERT INTO supplier_items (supplier_id, item_id, price) VALUES ($1,$2,$3) ON CONFLICT (supplier_id, item_id) DO UPDATE SET price = EXCLUDED.price, updated_at = now()`, [s.id, it.id, price]);
  await log(req, { action: 'update', entity: 'master', detail: `Harga ${it.name} dari ${s.name}: ${price == null ? 'tanpa harga' : rpText(price)}` });
  res.json({ ok: true });
});

async function saveExpenseItem(req: Request, id: number | null) {
  const rid = restoId(req);
  const kind = req.body.kind === 'employee' ? 'employee' : req.body.kind === 'daily' ? 'daily' : null;
  if (!kind) throw bad('Pilih jenis: Harian atau Karyawan');
  const d = { name: text(req.body.name), unit: textOrNull(req.body.unit), default_price: priceOf(req.body.default_price, 'Harga default'),
    category: textOrNull(req.body.category) ?? EXPENSE_CAT[kind].category, sub_category: textOrNull(req.body.sub_category) ?? EXPENSE_CAT[kind].sub_category };
  if (!d.name) throw bad('Isi nama bahan');
  return tx(async (c) => {
    await assertUniqueName(c, 'expense_items', rid, d.name, id, 'Bahan belanja', 'AND kind = $4', [kind]);
    const row = id
      ? await one(`UPDATE expense_items SET kind = $3, name = $4, unit = $5, default_price = $6, category = $7, sub_category = $8 WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL RETURNING *`,
          [id, rid, kind, d.name, d.unit, d.default_price, d.category, d.sub_category], c)
      : await one(`INSERT INTO expense_items (resto_id, kind, name, unit, default_price, category, sub_category) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [rid, kind, d.name, d.unit, d.default_price, d.category, d.sub_category], c);
    if (!row) throw notFound('Bahan belanja');
    await log(req, { action: id ? 'update' : 'create', entity: 'master', entityId: row.id, detail: `${id ? 'Mengubah' : 'Menambah'} bahan belanja ${kind === 'daily' ? 'harian' : 'karyawan'} ${d.name}` }, c);
    return row;
  });
}
r.post('/master/expense-items', only(...ADMIN_ROLES), async (req, res) => res.status(201).json(await saveExpenseItem(req, null)));
r.put('/master/expense-items/:id', only(...ADMIN_ROLES), async (req, res) => res.json(await saveExpenseItem(req, Number(req.params.id) || 0)));

async function saveAccount(req: Request, id: number | null) {
  const rid = restoId(req);
  const name = text(req.body.name);
  if (!name) throw bad('Isi nama kas / rekening');
  return tx(async (c) => {
    await assertUniqueName(c, 'pay_accounts', rid, name, id, 'Rekening');
    const row = id
      ? await one(`UPDATE pay_accounts SET name = $3 WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL RETURNING *`, [id, rid, name], c)
      : await one(`INSERT INTO pay_accounts (resto_id, name) VALUES ($1,$2) RETURNING *`, [rid, name], c);
    if (!row) throw notFound('Rekening');
    await log(req, { action: id ? 'update' : 'create', entity: 'master', entityId: row.id, detail: `${id ? 'Mengubah' : 'Menambah'} rekening ${name}` }, c);
    return row;
  });
}
r.post('/master/accounts', only(...ADMIN_ROLES), async (req, res) => res.status(201).json(await saveAccount(req, null)));
r.put('/master/accounts/:id', only(...ADMIN_ROLES), async (req, res) => res.json(await saveAccount(req, Number(req.params.id) || 0)));

// Metode pendapatan shift (Tunai, QRIS, …) & kas / rekening tempat uangnya masuk
async function saveRevenueMethod(req: Request, id: number | null) {
  const rid = restoId(req);
  const name = text(req.body.name);
  if (!name) throw bad('Isi nama metode');
  const sort = Number(req.body.sort) || 0;
  return tx(async (c) => {
    await assertUniqueName(c, 'revenue_methods', rid, name, id, 'Metode');
    const accId = req.body.pay_account_id ? Number(req.body.pay_account_id) : null;
    const acc = accId ? await one(`SELECT name FROM pay_accounts WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL`, [accId, rid], c) : null;
    if (accId && !acc) throw bad('Pilih kas / rekening yang valid');
    const row = id
      ? await one(`UPDATE revenue_methods SET name = $3, pay_account_id = $4, sort = $5 WHERE id = $1 AND resto_id = $2 AND deleted_at IS NULL RETURNING *`, [id, rid, name, accId, sort], c)
      : await one(`INSERT INTO revenue_methods (resto_id, name, pay_account_id, sort) VALUES ($1,$2,$3,$4) RETURNING *`, [rid, name, accId, sort], c);
    if (!row) throw notFound('Metode');
    await log(req, { action: id ? 'update' : 'create', entity: 'master', entityId: row.id, detail: `${id ? 'Mengubah' : 'Menambah'} metode pendapatan ${name}${acc ? ` → ${acc.name}` : ''}` }, c);
    return row;
  });
}
r.post('/master/revenue-methods', only(...ADMIN_ROLES), async (req, res) => res.status(201).json(await saveRevenueMethod(req, null)));
r.put('/master/revenue-methods/:id', only(...ADMIN_ROLES), async (req, res) => res.json(await saveRevenueMethod(req, Number(req.params.id) || 0)));

// ---------- Template Excel ----------
// ?filled=1: template berisi data saat ini (untuk diubah lalu diimpor kembali)
r.get('/master/template', only(...ADMIN_ROLES), async (req, res) => {
  const rid = restoId(req);
  const filled = req.query.filled === '1';
  const resto = await one(`SELECT name, code FROM restos WHERE id = $1`, [rid]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'momo lite PO';
  const guide = wb.addWorksheet('Petunjuk');
  guide.getColumn(1).width = 110;
  [
    [`Template Master Data — ${resto.name} (${resto.code})`, true],
    ['', false],
    ['Cara pakai:', true],
    ['1. Isi setiap sheet mulai baris 2. Kolom berjudul oranye (bertanda *) wajib diisi.', false],
    ['2. Bahan PO: barang yang dipesan lewat Purchase Order ke supplier (masuk persediaan).', false],
    ['3. Supplier: daftar supplier. Termin Default K/T = usulan pembayaran saat PO dibuat (K = kredit/hutang, T = tunai).', false],
    ['4. Harga Supplier: bahan apa yang dijual tiap supplier beserta harganya. Nama supplier & bahan harus sama dengan sheet Supplier & Bahan PO (boleh yang sudah ada di sistem).', false],
    ['5. Bahan Belanja: bahan untuk Belanja Harian (Jenis = Harian) dan Belanja Karyawan (Jenis = Karyawan). Tidak masuk persediaan.', false],
    ['6. Rekening: daftar kas / rekening bank untuk pembayaran (kolom Rekening di jurnal umum).', false],
    ['7. Simpan file sebagai .xlsx lalu impor di menu Master Data → Impor Excel. Sistem menampilkan pratinjau & kesalahan sebelum menyimpan.', false],
    ['', false],
    ['Aturan impor:', true],
    ['• Data dicocokkan berdasarkan nama (huruf besar/kecil diabaikan): nama yang sudah ada diperbarui, nama baru ditambahkan.', false],
    ['• Baris yang tidak ada di file TIDAK dihapus. Hapus data lewat halaman Master Data.', false],
    ['• Kolom tidak wajib yang dikosongkan tidak menghapus nilai yang sudah tersimpan.', false],
    ['• Sheet yang tidak dipakai boleh dibiarkan kosong atau dihapus. Baris yang diawali "Contoh:" diabaikan (boleh dihapus).', false],
    ['• Satuan bahan PO tidak bisa diubah bila bahan itu sudah pernah dipesan.', false],
  ].forEach(([t, b], i) => { const c = guide.getCell(i + 1, 1); c.value = t as string; if (b) c.font = { bold: true, size: i === 0 ? 14 : 11 }; });

  const data = filled ? {
    items: await q(`SELECT name, unit, category, sub_category FROM items WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY name`, [rid]),
    suppliers: await q(`SELECT name, contact_name, phone, address, CASE default_terms WHEN 'credit' THEN 'K' WHEN 'cash' THEN 'T' END AS terms
                          FROM suppliers WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY name`, [rid]),
    prices: await q(`SELECT s.name AS supplier, i.name AS item, si.price FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id AND s.deleted_at IS NULL
                       JOIN items i ON i.id = si.item_id AND i.deleted_at IS NULL WHERE s.resto_id = $1 ORDER BY s.name, i.name`, [rid]),
    expenseItems: await q(`SELECT CASE kind WHEN 'daily' THEN 'Harian' ELSE 'Karyawan' END AS kind, name, unit, default_price, category, sub_category
                             FROM expense_items WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY kind, name`, [rid]),
    accounts: await q(`SELECT name FROM pay_accounts WHERE resto_id = $1 AND deleted_at IS NULL ORDER BY id`, [rid]),
  } : {
    // contoh baris pada template kosong
    items: [{ name: 'Contoh: Daging Sapi Has Dalam', unit: 'kg', category: '2.1 Biaya Bahan Baku Produksi', sub_category: 'Daging' }],
    suppliers: [{ name: 'Contoh: CV Sumber Daging', contact_name: 'Pak Budi', phone: '08123456789', address: 'Jl. Pasar Baru 1', terms: 'K' }],
    prices: [{ supplier: 'Contoh: CV Sumber Daging', item: 'Contoh: Daging Sapi Has Dalam', price: 145000 }],
    expenseItems: [
      { kind: 'Harian', name: 'Contoh: Cabai Rawit', unit: 'kg', default_price: 60000 },
      { kind: 'Karyawan', name: 'Contoh: Beras Makan Karyawan', unit: 'kg', default_price: 14000 },
    ],
    accounts: [{ name: 'Kas tunai' }, { name: 'Kas non-tunai' }],
  };
  for (const [key, sh] of Object.entries(SHEETS)) addTableSheet(wb, sh.name, sh.cols, (data as any)[key]);
  await log(req, { action: 'export', entity: 'master', detail: filled ? 'Mengunduh master data (Excel)' : 'Mengunduh template master data' });
  await sendWorkbook(res, wb, filled ? `master-data-${resto.code}.xlsx` : `template-master-${resto.code}.xlsx`);
});

// ---------- Impor Excel ----------
type Issue = { sheet: string; row: number; message: string };
type Count = { create: number; update: number; same: number };

async function runImport(c: PoolClient, rid: number, wb: ExcelJS.Workbook, write: boolean) {
  const errors: Issue[] = [];
  const summary: Record<string, Count> = {};
  const count = (sheet: string) => (summary[sheet] ??= { create: 0, update: 0, same: 0 });
  const key = (s: string) => s.trim().toLowerCase();
  const textOrNull = (s: string) => s.trim() || null;
  let found = 0;

  // --- Rekening ---
  const accRows = readSheet(wb, SHEETS.accounts.name, SHEETS.accounts.cols);
  if (accRows) {
    found++;
    const existing = new Set((await q(`SELECT lower(name) AS n FROM pay_accounts WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => x.n));
    const seen = new Set<string>();
    for (const { row, values: v } of accRows) {
      const sheet = SHEETS.accounts.name;
      if (!v.name) { errors.push({ sheet, row, message: 'Nama kas / rekening kosong' }); continue; }
      if (seen.has(key(v.name))) { errors.push({ sheet, row, message: `"${v.name}" ditulis lebih dari sekali` }); continue; }
      seen.add(key(v.name));
      if (existing.has(key(v.name))) { count(sheet).same++; continue; }
      count(sheet).create++;
      if (write) await q(`INSERT INTO pay_accounts (resto_id, name) VALUES ($1,$2)`, [rid, v.name.trim()], c);
    }
  }

  // --- Bahan PO ---
  const itemRows = readSheet(wb, SHEETS.items.name, SHEETS.items.cols);
  const itemNames = new Set((await q(`SELECT lower(name) AS n FROM items WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => x.n));
  if (itemRows) {
    found++;
    const sheet = SHEETS.items.name;
    const existing = new Map((await q(
      `SELECT i.*, EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.item_id = i.id) AS used FROM items i WHERE i.resto_id = $1 AND i.deleted_at IS NULL`, [rid], c,
    )).map((x) => [key(x.name), x]));
    const seen = new Set<string>();
    for (const { row, values: v } of itemRows) {
      if (!v.name) { errors.push({ sheet, row, message: 'Nama bahan kosong' }); continue; }
      if (!v.unit) { errors.push({ sheet, row, message: `Satuan "${v.name}" kosong` }); continue; }
      if (seen.has(key(v.name))) { errors.push({ sheet, row, message: `Bahan "${v.name}" ditulis lebih dari sekali` }); continue; }
      seen.add(key(v.name));
      itemNames.add(key(v.name));
      const cur = existing.get(key(v.name));
      // kolom opsional yang dikosongkan = nilai lama tetap
      const d = { name: v.name.trim(), unit: v.unit.trim(), category: textOrNull(v.category) ?? cur?.category ?? null, sub_category: textOrNull(v.sub_category) ?? cur?.sub_category ?? null };
      if (!cur) {
        count(sheet).create++;
        if (write) await q(`INSERT INTO items (resto_id, name, unit, category, sub_category) VALUES ($1,$2,$3,$4,$5)`, [rid, d.name, d.unit, d.category, d.sub_category], c);
        continue;
      }
      if (cur.used && key(cur.unit) !== key(d.unit)) { errors.push({ sheet, row, message: `Satuan "${cur.name}" tidak bisa diubah (${cur.unit} → ${d.unit}) karena sudah pernah dipesan` }); continue; }
      if (cur.name === d.name && cur.unit === d.unit && cur.category === d.category && cur.sub_category === d.sub_category) { count(sheet).same++; continue; }
      count(sheet).update++;
      if (write) await q(`UPDATE items SET name = $2, unit = $3, category = $4, sub_category = $5 WHERE id = $1`, [cur.id, d.name, d.unit, d.category, d.sub_category], c);
    }
  }

  // --- Supplier ---
  const supRows = readSheet(wb, SHEETS.suppliers.name, SHEETS.suppliers.cols);
  const supNames = new Set((await q(`SELECT lower(name) AS n FROM suppliers WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => x.n));
  if (supRows) {
    found++;
    const sheet = SHEETS.suppliers.name;
    const existing = new Map((await q(`SELECT * FROM suppliers WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => [key(x.name), x]));
    const seen = new Set<string>();
    for (const { row, values: v } of supRows) {
      if (!v.name) { errors.push({ sheet, row, message: 'Nama supplier kosong' }); continue; }
      if (seen.has(key(v.name))) { errors.push({ sheet, row, message: `Supplier "${v.name}" ditulis lebih dari sekali` }); continue; }
      seen.add(key(v.name));
      supNames.add(key(v.name));
      const terms = v.terms ? TERMS_TEXT[key(v.terms)] : null;
      if (v.terms && !terms) { errors.push({ sheet, row, message: `Termin "${v.terms}" tidak dikenal (isi K atau T)` }); continue; }
      const cur = existing.get(key(v.name));
      const d = { name: v.name.trim(), contact_name: textOrNull(v.contact_name) ?? cur?.contact_name ?? null, phone: textOrNull(v.phone) ?? cur?.phone ?? null,
        address: textOrNull(v.address) ?? cur?.address ?? null, default_terms: terms ?? cur?.default_terms ?? null };
      if (!cur) {
        count(sheet).create++;
        if (write) await q(`INSERT INTO suppliers (resto_id, name, contact_name, phone, address, default_terms) VALUES ($1,$2,$3,$4,$5,$6)`,
          [rid, d.name, d.contact_name, d.phone, d.address, d.default_terms], c);
        continue;
      }
      if (cur.name === d.name && cur.contact_name === d.contact_name && cur.phone === d.phone && cur.address === d.address && cur.default_terms === d.default_terms) { count(sheet).same++; continue; }
      count(sheet).update++;
      if (write) await q(`UPDATE suppliers SET name = $2, contact_name = $3, phone = $4, address = $5, default_terms = $6 WHERE id = $1`,
        [cur.id, d.name, d.contact_name, d.phone, d.address, d.default_terms], c);
    }
  }

  // --- Harga supplier (setelah bahan & supplier tersimpan) ---
  const priceRows = readSheet(wb, SHEETS.prices.name, SHEETS.prices.cols);
  if (priceRows) {
    found++;
    const sheet = SHEETS.prices.name;
    const items = new Map((await q(`SELECT id, name FROM items WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => [key(x.name), x.id]));
    const sups = new Map((await q(`SELECT id, name FROM suppliers WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => [key(x.name), x.id]));
    const existing = new Map((await q(`SELECT si.* FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id WHERE s.resto_id = $1`, [rid], c))
      .map((x) => [`${x.supplier_id}:${x.item_id}`, x]));
    const seen = new Set<string>();
    for (const { row, values: v } of priceRows) {
      if (!v.supplier || !v.item) { errors.push({ sheet, row, message: 'Isi Supplier dan Bahan' }); continue; }
      if (!supNames.has(key(v.supplier))) { errors.push({ sheet, row, message: `Supplier "${v.supplier}" tidak ada di sheet Supplier maupun di sistem` }); continue; }
      if (!itemNames.has(key(v.item))) { errors.push({ sheet, row, message: `Bahan "${v.item}" tidak ada di sheet Bahan PO maupun di sistem` }); continue; }
      const price = parseNumber(v.price);
      if (price !== null && (Number.isNaN(price) || price < 0)) { errors.push({ sheet, row, message: `Harga "${v.price}" tidak valid` }); continue; }
      const pair = `${key(v.supplier)}|${key(v.item)}`;
      if (seen.has(pair)) { errors.push({ sheet, row, message: `${v.item} dari ${v.supplier} ditulis lebih dari sekali` }); continue; }
      seen.add(pair);
      // saat pratinjau, bahan / supplier baru belum punya id
      const sid = sups.get(key(v.supplier)), iid = items.get(key(v.item));
      const cur = sid && iid ? existing.get(`${sid}:${iid}`) : undefined;
      if (cur && price === null) { count(sheet).same++; continue; }
      if (cur && (cur.price ?? null) === price) { count(sheet).same++; continue; }
      count(sheet)[cur ? 'update' : 'create']++;
      if (write)
        await q(`INSERT INTO supplier_items (supplier_id, item_id, price) VALUES ($1,$2,$3)
                 ON CONFLICT (supplier_id, item_id) DO UPDATE SET price = EXCLUDED.price, updated_at = now()`, [sid, iid, price], c);
    }
  }

  // --- Bahan belanja harian & karyawan ---
  const expRows = readSheet(wb, SHEETS.expenseItems.name, SHEETS.expenseItems.cols);
  if (expRows) {
    found++;
    const sheet = SHEETS.expenseItems.name;
    const existing = new Map((await q(`SELECT * FROM expense_items WHERE resto_id = $1 AND deleted_at IS NULL`, [rid], c)).map((x) => [`${x.kind}:${key(x.name)}`, x]));
    const seen = new Set<string>();
    for (const { row, values: v } of expRows) {
      const kind = KIND_TEXT[key(v.kind)];
      if (!kind) { errors.push({ sheet, row, message: `Jenis "${v.kind}" tidak dikenal (isi Harian atau Karyawan)` }); continue; }
      if (!v.name) { errors.push({ sheet, row, message: 'Nama bahan kosong' }); continue; }
      const k = `${kind}:${key(v.name)}`;
      if (seen.has(k)) { errors.push({ sheet, row, message: `"${v.name}" (${v.kind}) ditulis lebih dari sekali` }); continue; }
      seen.add(k);
      const price = parseNumber(v.default_price);
      if (price !== null && (Number.isNaN(price) || price < 0)) { errors.push({ sheet, row, message: `Harga "${v.default_price}" tidak valid` }); continue; }
      const cur = existing.get(k);
      const d = { name: v.name.trim(), unit: textOrNull(v.unit) ?? cur?.unit ?? null, default_price: price ?? cur?.default_price ?? null,
        category: textOrNull(v.category) ?? cur?.category ?? EXPENSE_CAT[kind].category, sub_category: textOrNull(v.sub_category) ?? cur?.sub_category ?? EXPENSE_CAT[kind].sub_category };
      if (!cur) {
        count(sheet).create++;
        if (write) await q(`INSERT INTO expense_items (resto_id, kind, name, unit, default_price, category, sub_category) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [rid, kind, d.name, d.unit, d.default_price, d.category, d.sub_category], c);
        continue;
      }
      if (cur.name === d.name && cur.unit === d.unit && (cur.default_price ?? null) === d.default_price && cur.category === d.category && cur.sub_category === d.sub_category) { count(sheet).same++; continue; }
      count(sheet).update++;
      if (write) await q(`UPDATE expense_items SET name = $2, unit = $3, default_price = $4, category = $5, sub_category = $6 WHERE id = $1`,
        [cur.id, d.name, d.unit, d.default_price, d.category, d.sub_category], c);
    }
  }

  if (!found) throw bad('Tidak ada sheet template di file ini (Bahan PO, Supplier, Harga Supplier, Bahan Belanja, Rekening). Gunakan template yang diunduh dari sistem.');
  return { summary, errors };
}

// dry=true: pratinjau saja. Disimpan hanya bila tidak ada kesalahan (semua atau tidak sama sekali).
r.post('/master/import', only(...ADMIN_ROLES), async (req, res) => {
  const rid = restoId(req);
  const wb = await loadWorkbook(req.body.file);
  const dry = !!req.body.dry;
  const out = await tx(async (c) => {
    const result = await runImport(c, rid, wb, !dry);
    if (!dry && result.errors.length) throw Object.assign(new HttpError(400, `Ada ${result.errors.length} kesalahan di file. Perbaiki lalu impor ulang.`), { code: 'IMPORT_ERRORS' });
    return result;
  });
  if (!dry) {
    const parts = Object.entries(out.summary).map(([s, n]) => `${s}: +${n.create} baru, ${n.update} diubah`);
    await log(req, { action: 'import', entity: 'master', detail: `Impor master data dari Excel${req.body.filename ? ` (${String(req.body.filename).slice(0, 80)})` : ''} — ${parts.join('; ')}` });
  }
  res.json({ ...out, saved: !dry });
});

export default r;
