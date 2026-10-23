import { Router } from 'express';
import { one } from '../lib/db.ts';
import { HttpError, notFound } from '../lib/http.ts';
import { restoId } from '../lib/auth.ts';
import { saveUpload } from '../lib/uploads.ts';

const r = Router();

// receiving: foto barang & nota PO, expense: nota belanja, payment: bukti pelunasan hutang (Central Admin)
r.post('/uploads', async (req, res) => {
  const kind = ['receiving', 'expense', 'payment'].includes(req.body.kind) ? req.body.kind : null;
  if (!kind) throw new HttpError(400, 'Jenis foto tidak valid');
  if (kind === 'payment' && req.s.role !== 'central') throw new HttpError(403, 'Anda tidak punya izin mengunggah gambar ini');
  const u = await saveUpload(undefined, restoId(req), req.s.userId, kind, req.body.data);
  res.status(201).json({ id: u.id, size: u.size, url: `/api/uploads/${u.id}` });
});

r.get('/uploads/:id', async (req, res) => {
  const u = await one(`SELECT mime, data FROM uploads WHERE id = $1 AND resto_id = $2`, [Number(req.params.id) || 0, restoId(req)]);
  if (!u) throw notFound('Gambar');
  res.set('Content-Type', u.mime).set('Cache-Control', 'private, max-age=31536000, immutable').set('X-Content-Type-Options', 'nosniff');
  res.send(u.data);
});

export default r;
