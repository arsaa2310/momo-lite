import { pool, q, tx } from '../src/lib/db.ts';

// Perbaikan sekali jalan: harga yang tertulis tanpa ribuan (mis. 17 maksudnya 17.000) dikali 1.000.
//   npm run fix:prices            → pratinjau saja, tidak mengubah apa pun
//   npm run fix:prices -- --apply → simpan perubahan
// Yang diubah: harga supplier (supplier_items), harga default bahan belanja (expense_items), dan harga baris PO yang belum
// ada barang datang (status open). Kedatangan & belanja yang sudah tercatat di jurnal tidak disentuh — hanya ditampilkan.
// Bahan bersatuan kecil (gram, ml, …) dilewati karena harga di bawah Rp1.000 per satuan memang wajar; ubah lewat form bila perlu.
const apply = process.argv.includes('--apply');
const SMALL_UNITS = ['g', 'gr', 'gram', 'ml', 'cc', 'mg'];
const small = (unit: string | null) => SMALL_UNITS.includes(String(unit ?? '').trim().toLowerCase());
const rp = (n: unknown) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;

const supplierPrices = await q(
  `SELECT si.supplier_id, si.item_id, si.price, i.name AS item, i.unit, s.name AS supplier, r.code
     FROM supplier_items si JOIN items i ON i.id = si.item_id JOIN suppliers s ON s.id = si.supplier_id JOIN restos r ON r.id = s.resto_id
    WHERE si.price > 0 AND si.price < 1000 AND i.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY r.code, i.name`);
const expensePrices = await q(
  `SELECT e.id, e.name, e.unit, e.default_price AS price, r.code FROM expense_items e JOIN restos r ON r.id = e.resto_id
    WHERE e.default_price > 0 AND e.default_price < 1000 AND e.deleted_at IS NULL ORDER BY r.code, e.name`);
const openLines = await q(
  `SELECT l.id, l.unit_cost AS price, l.qty, i.name, i.unit, p.number FROM purchase_order_lines l
     JOIN purchase_orders p ON p.id = l.purchase_order_id JOIN items i ON i.id = l.item_id
    WHERE p.status = 'open' AND l.unit_cost > 0 AND l.unit_cost < 1000 ORDER BY p.number, i.name`);
const recorded = await q(
  `SELECT p.number, i.name, i.unit, l.unit_cost AS price FROM purchase_order_lines l
     JOIN purchase_orders p ON p.id = l.purchase_order_id JOIN items i ON i.id = l.item_id
    WHERE p.status <> 'open' AND l.unit_cost > 0 AND l.unit_cost < 1000 ORDER BY p.number, i.name`);

const show = (title: string, rows: any[], label: (r: any) => string) => {
  const fix = rows.filter((r) => !small(r.unit));
  const skip = rows.filter((r) => small(r.unit));
  console.log(`\n${title}: ${fix.length} diperbaiki${skip.length ? `, ${skip.length} dilewati (satuan kecil)` : ''}`);
  for (const r of fix) console.log(`  ${label(r)}: ${rp(r.price)} → ${rp(Number(r.price) * 1000)}`);
  for (const r of skip) console.log(`  (dilewati) ${label(r)}: ${rp(r.price)} per ${r.unit}`);
  return fix;
};
const sp = show('Harga supplier', supplierPrices, (r) => `[${r.code}] ${r.item} / ${r.unit} dari ${r.supplier}`);
const ep = show('Harga default bahan belanja', expensePrices, (r) => `[${r.code}] ${r.name}${r.unit ? ` / ${r.unit}` : ''}`);
const pl = show('Harga baris PO yang belum ada barang datang', openLines, (r) => `${r.number} ${r.name} / ${r.unit}`);
if (recorded.length) {
  console.log(`\nTidak diubah — PO yang barangnya sudah datang / selesai / batal (${recorded.length} baris), cek manual bila salah:`);
  for (const r of recorded) console.log(`  ${r.number} ${r.name} / ${r.unit}: ${rp(r.price)}`);
}

if (!apply) {
  console.log('\nPratinjau saja. Jalankan dengan --apply untuk menyimpan.');
} else {
  await tx(async (c) => {
    for (const r of sp) await q(`UPDATE supplier_items SET price = price * 1000, updated_at = now() WHERE supplier_id = $1 AND item_id = $2 AND price < 1000`, [r.supplier_id, r.item_id], c);
    for (const r of ep) await q(`UPDATE expense_items SET default_price = default_price * 1000 WHERE id = $1 AND default_price < 1000`, [r.id], c);
    for (const r of pl) await q(`UPDATE purchase_order_lines SET unit_cost = unit_cost * 1000 WHERE id = $1 AND unit_cost < 1000`, [r.id], c);
  });
  console.log(`\nTersimpan: ${sp.length} harga supplier, ${ep.length} bahan belanja, ${pl.length} baris PO.`);
}
await pool.end();
