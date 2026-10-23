import ExcelJS from 'exceljs';
import { bad } from './http.ts';

// Utilitas Excel bersama: template master data, impor, dan ekspor jurnal umum.

export type Col = { header: string; key: string; width?: number; required?: boolean; type?: 'money' | 'number' | 'text' | 'date'; note?: string; list?: string };
export const FMT = { money: '#,##0;[Red]-#,##0', number: '#,##0.###', date: 'dd/mm/yyyy' } as const;

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const;
const REQ_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB84418' } } as const;

// Sheet dengan baris judul kolom (wajib = oranye + tanda *), lebar kolom, freeze, dan validasi daftar.
export function addTableSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, any>[], maxRows = 2000) {
  const ws = wb.addWorksheet(name);
  cols.forEach((c, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = c.required ? `${c.header} *` : c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = c.required ? REQ_FILL : HEAD_FILL;
    cell.alignment = { vertical: 'middle' };
    if (c.note) cell.note = c.note;
    ws.getColumn(i + 1).width = c.width ?? Math.max(14, c.header.length + 4);
    if (c.type === 'money') ws.getColumn(i + 1).numFmt = FMT.money;
    if (c.type === 'number') ws.getColumn(i + 1).numFmt = FMT.number;
    if (c.list) {
      // daftar pilihan (dropdown) untuk baris data
      for (let r = 2; r <= maxRows; r++)
        ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: !c.required, formulae: [c.list], showErrorMessage: true, errorTitle: c.header, error: 'Pilih dari daftar' };
    }
  });
  rows.forEach((row, ri) => cols.forEach((c, ci) => {
    const v = row[c.key];
    ws.getCell(ri + 2, ci + 1).value = v == null || v === '' ? null : c.type === 'money' || c.type === 'number' ? Number(v) : v;
  }));
  ws.getRow(1).height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

// Nilai sel sebagai teks bersih (rich text, hyperlink, rumus, tanggal)
export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return new Date(v.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(v).trim();
}

export const norm = (s: string) => s.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();

// Baris data satu sheet: { row (nomor baris Excel), values: { key: teks } }. Kolom dicocokkan dari judul (tanpa *).
export function readSheet(wb: ExcelJS.Workbook, name: string, cols: Col[]) {
  const ws = wb.worksheets.find((w) => norm(w.name) === norm(name));
  if (!ws) return null;
  const head = ws.getRow(1);
  const index = new Map<string, number>();
  head.eachCell((cell, i) => {
    const h = norm(cellText(cell.value));
    const c = cols.find((x) => norm(x.header) === h);
    if (c) index.set(c.key, i);
  });
  const missing = cols.filter((c) => c.required && !index.has(c.key));
  if (missing.length) throw bad(`Sheet "${ws.name}": kolom ${missing.map((c) => `"${c.header}"`).join(', ')} tidak ditemukan. Gunakan template terbaru.`);
  const out: { row: number; values: Record<string, string> }[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const values: Record<string, string> = {};
    for (const c of cols) values[c.key] = index.has(c.key) ? cellText(row.getCell(index.get(c.key)!).value) : '';
    // baris contoh di template kosong diabaikan
    if (Object.values(values).some((v) => v.startsWith('Contoh:'))) return;
    if (Object.values(values).some((v) => v !== '')) out.push({ row: n, values });
  });
  return out;
}

export async function loadWorkbook(base64: unknown) {
  const raw = String(base64 ?? '').replace(/^data:[^;]+;base64,/, '');
  if (!raw) throw bad('Pilih file Excel (.xlsx)');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length > 4 * 1024 * 1024) throw bad('File terlalu besar (maks. 4 MB)');
  // .xlsx = arsip zip (PK..)
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw bad('File harus berformat .xlsx (Excel). Simpan ulang file sebagai Excel Workbook.');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as any);
  } catch {
    throw bad('File Excel tidak bisa dibaca');
  }
  return wb;
}

export async function sendWorkbook(res: any, wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf as ArrayBuffer));
}

// angka dari sel: menerima 12500, "12.500", "12,5", "Rp 12.500"
export function parseNumber(s: string): number | null {
  if (!s) return null;
  let t = s.replace(/rp/i, '').replace(/\s/g, '');
  // 12.500 / 1.250.000 = pemisah ribuan
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  // format Indonesia: titik ribuan, koma desimal
  t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
