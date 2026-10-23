import type { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const notFound = (what = 'Data') => new HttpError(404, `${what} tidak ditemukan`);
export const forbidden = () => new HttpError(403, 'Anda tidak punya akses ke menu ini');

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: (err as any).code });
  if (err?.code === '23505') return res.status(409).json({ error: 'Data dengan nilai tersebut sudah ada' });
  if (err?.code === '23503') return res.status(409).json({ error: 'Data masih dipakai atau referensinya tidak valid' });
  if (err?.code === '22P02' || err?.code === '23514' || err?.code === '23502')
    return res.status(400).json({ error: 'Input tidak valid' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server' });
}

// Validasi ringan: ambil field yang diizinkan, cek wajib.
export function pick(body: any, fields: string[], required: string[] = []) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (body?.[f] !== undefined) out[f] = body[f] === '' ? null : body[f];
  }
  for (const r of required) {
    if (out[r] === undefined || out[r] === null || (typeof out[r] === 'string' && !out[r].trim()))
      throw bad(`Kolom "${r}" wajib diisi`);
  }
  return out;
}

export function num(v: unknown, label: string, { min = 0 }: { min?: number } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw bad(`${label} tidak valid`);
  return n;
}

export function paging(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(200, Math.max(1, Number(req.query.size) || 25));
  return { page, size, offset: (page - 1) * size };
}

// Rentang tanggal laporan: ?from=YYYY-MM-DD&to=YYYY-MM-DD, zona waktu Asia/Jakarta.
export function range(req: Request) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : from;
  return { from: `${from}T00:00:00+07:00`, to: `${to}T23:59:59.999+07:00`, fromDate: from, toDate: to };
}
