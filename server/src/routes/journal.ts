import { Router, type Request } from 'express';
import ExcelJS from 'exceljs';
import { one, q } from '../lib/db.ts';
import { bad } from '../lib/http.ts';
import { only, restoId } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';
import { FMT, sendWorkbook } from '../lib/excel.ts';

// Jurnal umum (buku pembelian) mengikuti format momo: Tanggal, Term, Kode, Supplier, Barang, Sub Kategori, Kategori, Qty, Unit,
// Harga, PPN, Sub Total, Diskon, TOTAL (per hari + term), Tanggal Bayar, Rekening, CR/DB.
// Term: PTH = tunai harian (PO T & belanja harian/karyawan), PKH = kredit / hutang (PO K).
const r = Router();

type Row = {
  date: string; term: 'PTH' | 'PKH'; code: string; supplier: string; item: string; sub_category: string | null; category: string | null;
  qty: number; unit: string | null; price: number; ppn: number | null; subtotal: number; discount: number | null; total?: number | null;
  paid_date: string | null; rekening: string | null; crdb: string; ref: string; source: 'po' | 'daily' | 'employee';
};

function period(req: Request) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : today;
  if (from > to) throw bad('Tanggal awal melewati tanggal akhir');
  return { from, to };
}

export async function journalRows(rid: number, from: string, to: string): Promise<Row[]> {
  const resto = await one(`SELECT upper(code) AS code FROM restos WHERE id = $1`, [rid]);
  const rows: Row[] = [];
  const D = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

  // Kedatangan PO. PPN & diskon nota dibagi proporsional per baris.
  const po = await q(
    `SELECT rc.number, rc.paid, rc.ppn, rc.discount, ${D('rc.received_at')} AS date, pa.name AS rc_account,
            p.paid_date::text AS po_paid_date, pp.name AS po_account, s.name AS supplier,
            (SELECT sum(x.qty * x.unit_cost) FROM po_receipt_lines x WHERE x.receipt_id = rc.id) AS gross,
            l.qty, l.unit_cost, i.name AS item, i.unit, i.category, i.sub_category
       FROM po_receipts rc JOIN purchase_orders p ON p.id = rc.purchase_order_id JOIN suppliers s ON s.id = p.supplier_id
       JOIN po_receipt_lines l ON l.receipt_id = rc.id JOIN purchase_order_lines pl ON pl.id = l.po_line_id JOIN items i ON i.id = pl.item_id
       LEFT JOIN pay_accounts pa ON pa.id = rc.pay_account_id LEFT JOIN pay_accounts pp ON pp.id = p.paid_account_id
      WHERE p.resto_id = $1 AND rc.reversed_at IS NULL
        AND rc.received_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Jakarta' AND rc.received_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'
      ORDER BY rc.received_at, l.id`,
    [rid, from, to],
  );
  for (const x of po) {
    const share = Number(x.gross) > 0 ? (Number(x.qty) * Number(x.unit_cost)) / Number(x.gross) : 0;
    rows.push({
      date: x.date, term: x.paid ? 'PTH' : 'PKH', code: resto.code, supplier: x.supplier, item: x.item, sub_category: x.sub_category,
      category: x.category ?? 'Persediaan', qty: Number(x.qty), unit: x.unit, price: Number(x.unit_cost),
      ppn: Number(x.ppn) ? Math.round(Number(x.ppn) * share) : null, subtotal: Number(x.qty) * Number(x.unit_cost),
      discount: Number(x.discount) ? Math.round(Number(x.discount) * share) : null,
      paid_date: x.paid ? x.date : x.po_paid_date, rekening: x.paid ? x.rc_account : x.po_paid_date ? x.po_account : null,
      crdb: 'CR', ref: x.number, source: 'po',
    });
  }

  // Belanja harian & karyawan
  for (const x of await q(
    `SELECT x.kind, x.number, x.supplier_name, x.expense_date::text AS date, pa.name AS account, l.name, l.unit, l.qty, l.amount, l.category, l.sub_category
       FROM expenses x JOIN expense_lines l ON l.expense_id = x.id LEFT JOIN pay_accounts pa ON pa.id = x.pay_account_id
      WHERE x.resto_id = $1 AND x.voided_at IS NULL AND x.expense_date BETWEEN $2 AND $3 ORDER BY x.expense_date, x.id, l.id`,
    [rid, from, to],
  ))
    rows.push({
      date: x.date, term: 'PTH', code: resto.code, supplier: x.supplier_name || (x.kind === 'employee' ? 'Belanja karyawan' : 'Belanja harian'),
      item: x.name, sub_category: x.sub_category, category: x.category ?? (x.kind === 'employee' ? 'Beban Konsumsi Karyawan' : 'HPP Belanja Harian'),
      qty: Number(x.qty), unit: x.unit, price: Number(x.amount) / Number(x.qty), ppn: null, subtotal: Number(x.amount), discount: null,
      paid_date: x.date, rekening: x.account, crdb: 'CR', ref: x.number, source: x.kind,
    });

  const rank = { PTH: 0, PKH: 1 };
  rows.sort((a, b) => a.date.localeCompare(b.date) || rank[a.term] - rank[b.term] || a.supplier.localeCompare(b.supplier) || a.ref.localeCompare(b.ref));
  // TOTAL di baris terakhir tiap kelompok hari + term
  for (let i = 0; i < rows.length; i++) {
    const r0 = rows[i]!, next = rows[i + 1];
    if (!next || next.date !== r0.date || next.term !== r0.term) {
      let sum = 0;
      for (let k = i; k >= 0 && rows[k]!.date === r0.date && rows[k]!.term === r0.term; k--) sum += rowTotal(rows[k]!);
      r0.total = Math.round(sum);
    }
  }
  return rows;
}
const rowTotal = (x: Row) => x.subtotal - (x.discount ?? 0) + (x.ppn ?? 0);

function totals(rows: Row[]) {
  const by = (f: (x: Row) => boolean) => Math.round(rows.filter(f).reduce((s, x) => s + rowTotal(x), 0));
  return {
    pth: by((x) => x.term === 'PTH'), pkh: by((x) => x.term === 'PKH'), all: by(() => true),
    po: by((x) => x.source === 'po'), daily: by((x) => x.source === 'daily'), employee: by((x) => x.source === 'employee'),
    unpaid: by((x) => x.term === 'PKH' && !x.paid_date),
  };
}

// rekap per kategori × term
function recap(rows: Row[]) {
  const m = new Map<string, { category: string; pth: number; pkh: number; total: number }>();
  for (const x of rows) {
    const k = x.category ?? '—';
    const v = m.get(k) ?? { category: k, pth: 0, pkh: 0, total: 0 };
    const t = rowTotal(x);
    if (x.term === 'PTH') v.pth += t; else v.pkh += t;
    v.total += t;
    m.set(k, v);
  }
  return [...m.values()].map((v) => ({ ...v, pth: Math.round(v.pth), pkh: Math.round(v.pkh), total: Math.round(v.total) })).sort((a, b) => a.category.localeCompare(b.category));
}

r.get('/journal', only('central'), async (req, res) => {
  const { from, to } = period(req);
  const rows = await journalRows(restoId(req), from, to);
  res.json({ from, to, rows, totals: totals(rows), recap: recap(rows) });
});

const COLS: { header: string; key: string; width: number; type?: keyof typeof FMT }[] = [
  { header: 'Tanggal', key: 'date', width: 12, type: 'date' },
  { header: 'Term', key: 'term', width: 7 },
  { header: 'Kode', key: 'code', width: 8 },
  { header: 'Supplier', key: 'supplier', width: 26 },
  { header: 'Barang', key: 'item', width: 30 },
  { header: 'Sub Kategori', key: 'sub_category', width: 18 },
  { header: 'Kategori', key: 'category', width: 28 },
  { header: 'Qty', key: 'qty', width: 9, type: 'number' },
  { header: 'Unit', key: 'unit', width: 8 },
  { header: 'Harga', key: 'price', width: 14, type: 'money' },
  { header: 'PPN', key: 'ppn', width: 11, type: 'money' },
  { header: 'Sub Total', key: 'subtotal', width: 15, type: 'money' },
  { header: 'Diskon', key: 'discount', width: 11, type: 'money' },
  { header: 'TOTAL', key: 'total', width: 15, type: 'money' },
  { header: 'Tanggal Bayar', key: 'paid_date', width: 13, type: 'date' },
  { header: 'Rekening', key: 'rekening', width: 22 },
  { header: 'CR/DB', key: 'crdb', width: 7 },
  { header: 'No. Dokumen', key: 'ref', width: 20 },
];
const asDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

r.get('/journal/export', only('central'), async (req, res) => {
  const rid = restoId(req);
  const { from, to } = period(req);
  const rows = await journalRows(rid, from, to);
  const resto = await one(`SELECT name, upper(code) AS code FROM restos WHERE id = $1`, [rid]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'momo lite PO';
  const ws = wb.addWorksheet('Jurnal Umum');
  ws.getCell(1, 1).value = `JURNAL UMUM — ${resto.name} (${resto.code})`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = `Periode ${from} s/d ${to} · PTH = tunai harian, PKH = kredit / hutang`;
  ws.getCell(2, 1).font = { color: { argb: 'FF666666' } };
  const head = 4;
  COLS.forEach((c, i) => {
    const cell = ws.getCell(head, i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: c.type && c.type !== 'date' ? 'right' : 'left' };
    ws.getColumn(i + 1).width = c.width;
  });
  rows.forEach((x, ri) => {
    COLS.forEach((c, ci) => {
      const v = (x as any)[c.key];
      const cell = ws.getCell(head + 1 + ri, ci + 1);
      cell.value = v == null || v === '' ? null : c.type === 'date' ? asDate(v) : c.type ? Number(v) : v;
      if (c.type) cell.numFmt = FMT[c.type];
      if (c.key === 'total' && v != null) cell.font = { bold: true };
    });
  });
  const t = totals(rows);
  const end = head + rows.length + 2;
  [['Total PTH (tunai)', t.pth], ['Total PKH (kredit / hutang)', t.pkh], ['  └ PKH belum dibayar', t.unpaid], ['TOTAL PEMBELIAN', t.all]].forEach(([label, v], i) => {
    ws.getCell(end + i, 12).value = label as string;
    ws.getCell(end + i, 12).font = { bold: true };
    ws.getCell(end + i, 14).value = v as number;
    ws.getCell(end + i, 14).numFmt = FMT.money;
    ws.getCell(end + i, 14).font = { bold: true };
  });
  ws.views = [{ state: 'frozen', ySplit: head }];
  if (rows.length) ws.autoFilter = { from: { row: head, column: 1 }, to: { row: head + rows.length, column: COLS.length } };

  const rs = wb.addWorksheet('Rekap Kategori');
  rs.getCell(1, 1).value = `Rekap per Kategori — ${from} s/d ${to}`;
  rs.getCell(1, 1).font = { bold: true, size: 13 };
  const rc = [['Kategori', 'category', 36], ['PTH', 'pth', 16], ['PKH', 'pkh', 16], ['Total', 'total', 16]] as const;
  rc.forEach(([h, , w], i) => {
    const cell = rs.getCell(3, i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    rs.getColumn(i + 1).width = w;
  });
  const rec = recap(rows);
  rec.forEach((x, ri) => rc.forEach(([, k], ci) => {
    const cell = rs.getCell(4 + ri, ci + 1);
    cell.value = (x as any)[k];
    if (ci) cell.numFmt = FMT.money;
  }));
  const tr = 4 + rec.length;
  rs.getCell(tr, 1).value = 'TOTAL';
  [t.pth, t.pkh, t.all].forEach((v, i) => { rs.getCell(tr, i + 2).value = v; rs.getCell(tr, i + 2).numFmt = FMT.money; });
  rs.getRow(tr).font = { bold: true };

  await log(req, { action: 'export', entity: 'journal', detail: `Mengekspor jurnal umum ${from} s/d ${to} (${rows.length} baris)` });
  await sendWorkbook(res, wb, `jurnal-umum-${resto.code}-${from}_${to}.xlsx`);
});

export default r;
