import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, q } from '../lib/db.ts';
import { HttpError, bad } from '../lib/http.ts';
import { COOKIE, RESTO_COOKIE, ROLE_LABEL, requireAuth, setSessionCookie, signSession } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';

const r = Router();

r.post('/login', async (req, res) => {
  const email = String(req.body.email ?? '').trim();
  const password = String(req.body.password ?? '');
  if (!email || !password) throw bad('Isi email dan kata sandi');
  const u = await one(
    `SELECT u.*, r.is_active AS resto_active, r.name AS resto_name FROM users u LEFT JOIN restos r ON r.id = u.resto_id WHERE lower(u.email) = lower($1)`,
    [email],
  );
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, 'Email atau kata sandi salah');
  if (!u.is_active) throw new HttpError(403, 'Akun ini dinonaktifkan. Hubungi admin.');
  if (u.resto_id && !u.resto_active) throw new HttpError(403, `Resto ${u.resto_name} sedang dinonaktifkan. Hubungi admin.`);
  await q(`UPDATE users SET last_login_at = now() WHERE id = $1`, [u.id]);
  setSessionCookie(res, signSession(u.id, u.token_version));
  req.s = { userId: u.id, name: u.name, email: u.email, role: u.role, restoId: u.resto_id, restoIds: u.resto_id ? [u.resto_id] : [] };
  await log(req, { action: 'login', entity: 'user', entityId: u.id, detail: `${u.name} masuk` });
  res.json({ ok: true });
});

r.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.clearCookie(RESTO_COOKIE, { path: '/' });
  res.json({ ok: true });
});

r.get('/me', requireAuth, async (req, res) => {
  const resto = req.s.restoId ? await one(`SELECT id, name, code, address, phone, shift_names FROM restos WHERE id = $1`, [req.s.restoId]) : null;
  // Owner: daftar resto yang bisa dipilih
  const restos = req.s.role === 'owner' ? await q(`SELECT id, name, code FROM restos WHERE id = ANY($1) ORDER BY name`, [req.s.restoIds]) : [];
  res.json({ user: { id: req.s.userId, name: req.s.name, email: req.s.email, role: req.s.role, role_label: ROLE_LABEL[req.s.role] }, resto, restos });
});

// Owner berpindah resto yang sedang dibuka
r.post('/resto', requireAuth, async (req, res) => {
  const id = Number(req.body.resto_id) || 0;
  if (req.s.role !== 'owner' || !req.s.restoIds.includes(id)) throw new HttpError(403, 'Resto ini bukan milik akun Anda');
  res.cookie(RESTO_COOKIE, String(id), { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 365 * 24 * 3600e3, path: '/' });
  res.json({ ok: true });
});

r.put('/password', requireAuth, async (req, res) => {
  const cur = String(req.body.current ?? ''), next = String(req.body.password ?? '');
  if (next.length < 8) throw bad('Kata sandi baru minimal 8 karakter');
  const u = await one(`SELECT password_hash, token_version FROM users WHERE id = $1`, [req.s.userId]);
  if (!(await bcrypt.compare(cur, u.password_hash))) throw bad('Kata sandi lama salah');
  const v = await one(`UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING token_version`,
    [req.s.userId, await bcrypt.hash(next, 10)]);
  setSessionCookie(res, signSession(req.s.userId, v.token_version));
  await log(req, { action: 'update', entity: 'user', entityId: req.s.userId, detail: 'Mengganti kata sandi sendiri' });
  res.json({ ok: true });
});

export default r;
