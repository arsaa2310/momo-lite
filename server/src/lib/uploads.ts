import type { PoolClient } from 'pg';
import { one, pool, type Db } from './db.ts';
import { bad } from './http.ts';

// Gambar dikirim sebagai data URL yang sudah dikompres di browser. Divalidasi dari isi file (bukan nama/ekstensi).
const MAX_BYTES = 3 * 1024 * 1024;
const SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/webp', (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP'],
];

export type UploadKind = 'receiving' | 'expense' | 'payment' | 'revenue';

export function decodeImage(dataUrl: unknown) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw bad('Format gambar tidak didukung (gunakan JPG, PNG, atau WebP)');
  const buf = Buffer.from(m[2]!, 'base64');
  if (!buf.length) throw bad('Gambar kosong');
  if (buf.length > MAX_BYTES) throw bad('Ukuran gambar terlalu besar (maks. 3 MB setelah dikompres)');
  const real = SIGNATURES.find(([, test]) => test(buf))?.[0];
  if (!real) throw bad('File bukan gambar yang valid');
  return { mime: real, buf };
}

export async function saveUpload(db: Db | undefined, restoId: number, userId: number, kind: UploadKind, dataUrl: unknown) {
  const { mime, buf } = decodeImage(dataUrl);
  return one(
    `INSERT INTO uploads (resto_id, kind, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, size`,
    [restoId, kind, mime, buf.length, buf, userId],
    db ?? pool,
  );
}

// Pastikan foto bukti milik resto ini & jenisnya sesuai.
export async function requirePhoto(c: PoolClient, restoId: number, kind: UploadKind, id: unknown, label: string) {
  const ok = Number(id) && (await one(`SELECT 1 AS ok FROM uploads WHERE id = $1 AND resto_id = $2 AND kind = $3`, [Number(id), restoId, kind], c));
  if (!ok) throw bad(`Lampirkan ${label}`);
  return Number(id);
}

// Foto tambahan (opsional), maks. 6
export async function extraPhotos(c: PoolClient, restoId: number, kind: UploadKind, ids: unknown) {
  const list = [...new Set(((ids as unknown[]) ?? []).map(Number).filter((n) => n > 0))].slice(0, 6);
  for (const id of list) await requirePhoto(c, restoId, kind, id, 'foto tambahan yang valid');
  return list;
}
