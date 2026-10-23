import bcrypt from 'bcryptjs';
import { pool, one, q } from '../src/lib/db.ts';

// Data demo: resto "Resto Demo" (DMO) dengan Central Admin, Purchasing, dan sedikit master data.
// Akun: central@lite.id / po@lite.id, kata sandi lite1234. Tidak melakukan apa-apa bila resto DMO sudah ada.
if (await one(`SELECT 1 AS ok FROM restos WHERE upper(code) = 'DMO'`)) {
  console.log('Resto demo sudah ada.');
  await pool.end();
  process.exit(0);
}
const resto = await one(`INSERT INTO restos (name, code, address, phone) VALUES ('Resto Demo', 'DMO', 'Jl. Contoh No. 1, Jakarta', '021-555-0101') RETURNING id`);
const hash = await bcrypt.hash('lite1234', 10);
await q(`INSERT INTO users (resto_id, role, name, email, password_hash) VALUES ($1,'central','Citra Central','central@lite.id',$2), ($1,'purchasing','Pandu Purchasing','po@lite.id',$2)`, [resto.id, hash]);
for (const a of ['Kas tunai', 'Kas non-tunai', 'BCA 1234567890']) await q(`INSERT INTO pay_accounts (resto_id, name) VALUES ($1,$2)`, [resto.id, a]);

const items: [string, string, string, string][] = [
  ['Daging Sapi Has Dalam', 'kg', '2.1 Biaya Bahan Baku Produksi', 'Daging'],
  ['Ayam Fillet', 'kg', '2.1 Biaya Bahan Baku Produksi', 'Daging'],
  ['Beras Premium', 'kg', '2.1 Biaya Bahan Baku Produksi', 'Beras'],
  ['Minyak Goreng', 'liter', '2.1 Biaya Bahan Baku Produksi', 'Minyak'],
  ['Susu UHT', 'liter', '2.2 Biaya Bahan Baku Minuman', 'Susu'],
];
const itemId: Record<string, number> = {};
for (const [name, unit, cat, sub] of items)
  itemId[name] = (await one(`INSERT INTO items (resto_id, name, unit, category, sub_category) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [resto.id, name, unit, cat, sub])).id;
const sup = async (name: string, terms: string, contact: string) =>
  (await one(`INSERT INTO suppliers (resto_id, name, default_terms, contact_name, phone) VALUES ($1,$2,$3,$4,'0812000000') RETURNING id`, [resto.id, name, terms, contact])).id;
const s1 = await sup('CV Sumber Daging', 'credit', 'Pak Budi');
const s2 = await sup('Toko Sembako Jaya', 'cash', 'Bu Sri');
const prices: [number, string, number][] = [
  [s1, 'Daging Sapi Has Dalam', 145000], [s1, 'Ayam Fillet', 52000],
  [s2, 'Beras Premium', 15500], [s2, 'Minyak Goreng', 18000], [s2, 'Susu UHT', 19000], [s2, 'Ayam Fillet', 54000],
];
for (const [s, item, price] of prices) await q(`INSERT INTO supplier_items (supplier_id, item_id, price) VALUES ($1,$2,$3)`, [s, itemId[item], price]);
const exp: [string, string, string, number][] = [
  ['daily', 'Cabai Rawit', 'kg', 60000], ['daily', 'Bawang Merah', 'kg', 38000], ['daily', 'Daun Bawang', 'ikat', 5000],
  ['employee', 'Beras Makan Karyawan', 'kg', 14000], ['employee', 'Telur Ayam', 'kg', 28000], ['employee', 'Sayur Karyawan', 'paket', 25000],
];
for (const [kind, name, unit, price] of exp)
  await q(`INSERT INTO expense_items (resto_id, kind, name, unit, default_price, category, sub_category) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [resto.id, kind, name, unit, price, kind === 'daily' ? '2.1 Biaya Bahan Baku Produksi' : '3.6 Biaya Natura', kind === 'daily' ? 'Bahan Harian' : 'Masak Karyawan']);
console.log('Resto demo dibuat: central@lite.id / po@lite.id (kata sandi lite1234)');
await pool.end();
