import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { one, q, tx } from '../lib/db.ts';
import { bad, notFound } from '../lib/http.ts';
import { ROLE_LABEL, only } from '../lib/auth.ts';
import { log } from '../lib/audit.ts';

// Panel admin (Super Admin): 1) membuat resto, 2) mendaftarkan Owner, Central Admin, Manager & orang PO tiap resto, 3) melihat log.
// Owner tidak terikat satu resto: akun yang sama bisa ditautkan ke beberapa resto (owner_restos).
const r = Router();
r.use(only('superadmin'));

const DEFAULT_ACCOUNTS = ['Kas tunai', 'Kas non-tunai'];
const DEFAULT_REVENUE_METHODS = ['Tunai', 'QRIS', 'Debit / Kartu', 'Transfer', 'Ojol / Online'];
const tempPassword = () => randomBytes(6).toString('base64url');

function restoBody(req: Request) {
  const name = String(req.body.name ?? '').trim();
  const code = String(req.body.code ?? '').trim().toUpperCase();
  if (!name) throw bad('Isi nama resto');
  if (!/^[A-Z0-9]{2,8}$/.test(code)) throw bad('Kode resto 2–8 huruf/angka (dipakai di nomor PO, mis. PO-ABC-00001)');
  return { name, code, address: String(req.body.address ?? '').trim() || null, phone: String(req.body.phone ?? '').trim() || null };
}

r.get('/restos', async (_req, res) => {
  res.json(await q(
    `SELECT r.*,
            (SELECT count(*)::int FROM owner_restos o JOIN users u ON u.id = o.user_id AND u.is_active WHERE o.resto_id = r.id) AS owner_count,
            (SELECT count(*)::int FROM users u WHERE u.resto_id = r.id AND u.role = 'central' AND u.is_active) AS central_count,
            (SELECT count(*)::int FROM users u WHERE u.resto_id = r.id AND u.role = 'manager' AND u.is_active) AS manager_count,
            (SELECT count(*)::int FROM users u WHERE u.resto_id = r.id AND u.role = 'purchasing' AND u.is_active) AS purchasing_count,
            (SELECT count(*)::int FROM purchase_orders p WHERE p.resto_id = r.id) AS po_count,
            (SELECT max(l.created_at) FROM activity_logs l WHERE l.resto_id = r.id) AS last_activity
       FROM restos r ORDER BY r.name`,
  ));
});

r.post('/restos', async (req, res) => {
  const d = restoBody(req);
  const row = await tx(async (c) => {
    const row = await one(`INSERT INTO restos (name, code, address, phone) VALUES ($1,$2,$3,$4) RETURNING *`, [d.name, d.code, d.address, d.phone], c);
    for (const a of DEFAULT_ACCOUNTS) await q(`INSERT INTO pay_accounts (resto_id, name) VALUES ($1,$2)`, [row.id, a], c);
    const cash = await one(`SELECT id FROM pay_accounts WHERE resto_id = $1 ORDER BY id LIMIT 1`, [row.id], c);
    for (const [i, m] of DEFAULT_REVENUE_METHODS.entries())
      await q(`INSERT INTO revenue_methods (resto_id, name, pay_account_id, sort) VALUES ($1,$2,$3,$4)`, [row.id, m, i === 0 ? cash.id : null, i + 1], c);
    await log(req, { action: 'create', entity: 'resto', entityId: row.id, restoId: row.id, detail: `Membuat resto ${d.name} (${d.code})` }, c);
    return row;
  });
  res.status(201).json(row);
});

r.put('/restos/:id', async (req, res) => {
  const d = restoBody(req);
  const old = await one(`SELECT * FROM restos WHERE id = $1`, [Number(req.params.id) || 0]);
  if (!old) throw notFound('Resto');
  if (old.code !== d.code && (await one(`SELECT 1 AS x FROM purchase_orders WHERE resto_id = $1 UNION ALL SELECT 1 FROM expenses WHERE resto_id = $1 LIMIT 1`, [old.id])))
    throw bad('Kode resto tidak bisa diubah setelah ada PO / belanja (nomor dokumen memakai kode ini)');
  const isActive = req.body.is_active === undefined ? old.is_active : !!req.body.is_active;
  const row = await one(`UPDATE restos SET name = $2, code = $3, address = $4, phone = $5, is_active = $6 WHERE id = $1 RETURNING *`,
    [old.id, d.name, d.code, d.address, d.phone, isActive]);
  const changes = [old.name !== d.name && `nama ${old.name} → ${d.name}`, old.code !== d.code && `kode ${old.code} → ${d.code}`,
    old.is_active !== isActive && (isActive ? 'diaktifkan' : 'dinonaktifkan')].filter(Boolean);
  await log(req, { action: 'update', entity: 'resto', entityId: old.id, restoId: old.id, detail: `Mengubah resto ${d.name}${changes.length ? `: ${changes.join(', ')}` : ''}` });
  res.json(row);
});

// ---------- Pengguna resto ----------
r.get('/restos/:id/users', async (req, res) => {
  const id = Number(req.params.id) || 0;
  res.json(await q(
    `SELECT id, role, name, email, is_active, last_login_at, created_at,
            (SELECT string_agg(r.code, ', ' ORDER BY r.code) FROM owner_restos o JOIN restos r ON r.id = o.resto_id WHERE o.user_id = u.id) AS owner_restos
       FROM users u WHERE u.resto_id = $1 OR u.id IN (SELECT user_id FROM owner_restos WHERE resto_id = $1)
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'central' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name`,
    [id],
  ));
});

const ROLES = ['owner', 'central', 'manager', 'purchasing'] as const;
function roleOf(v: unknown) {
  if (!ROLES.includes(v as any)) throw bad('Pilih peran: Owner, Central Admin, Manager, atau Purchasing');
  return v as (typeof ROLES)[number];
}

// Kata sandi awal: diisi admin, atau dibuat acak dan ditampilkan sekali.
r.post('/restos/:id/users', async (req, res) => {
  const resto = await one(`SELECT id, name FROM restos WHERE id = $1`, [Number(req.params.id) || 0]);
  if (!resto) throw notFound('Resto');
  const role = roleOf(req.body.role);
  const name = String(req.body.name ?? '').trim();
  const email = String(req.body.email ?? '').trim().toLowerCase();
  if (!name) throw bad('Isi nama');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email tidak valid');
  const given = String(req.body.password ?? '');
  if (given && given.length < 8) throw bad('Kata sandi minimal 8 karakter');
  // Owner yang sudah terdaftar (email sama) cukup ditautkan ke resto ini
  const existing = await one(`SELECT id, role, name FROM users WHERE lower(email) = lower($1)`, [email]);
  if (existing) {
    if (role !== 'owner' || existing.role !== 'owner') throw bad('Email ini sudah dipakai akun lain');
    const added = await one(`INSERT INTO owner_restos (user_id, resto_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING user_id`, [existing.id, resto.id]);
    if (!added) throw bad(`${existing.name} sudah menjadi Owner resto ini`);
    await log(req, { action: 'update', entity: 'user', entityId: existing.id, restoId: resto.id, detail: `Menautkan Owner ${existing.name} (${email}) ke ${resto.name}` });
    return res.status(201).json({ id: existing.id, password: null, linked: true });
  }
  const password = given || tempPassword();
  const u = await tx(async (c) => {
    const u = await one(`INSERT INTO users (resto_id, role, name, email, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [role === 'owner' ? null : resto.id, role, name, email, await bcrypt.hash(password, 10)], c);
    if (role === 'owner') await q(`INSERT INTO owner_restos (user_id, resto_id) VALUES ($1,$2)`, [u.id, resto.id], c);
    await log(req, { action: 'create', entity: 'user', entityId: u.id, restoId: resto.id, detail: `Menambah ${ROLE_LABEL[role]} ${name} (${email}) di ${resto.name}` }, c);
    return u;
  });
  res.status(201).json({ id: u.id, password: given ? null : password });
});

// Lepas Owner dari satu resto (akunnya tetap ada untuk resto lain)
r.delete('/restos/:id/owners/:userId', async (req, res) => {
  const row = await one(
    `DELETE FROM owner_restos o USING users u, restos r WHERE o.resto_id = $1 AND o.user_id = $2 AND u.id = o.user_id AND r.id = o.resto_id RETURNING u.name, r.name AS resto`,
    [Number(req.params.id) || 0, Number(req.params.userId) || 0]);
  if (!row) throw notFound('Owner');
  await log(req, { action: 'update', entity: 'user', entityId: Number(req.params.userId), restoId: Number(req.params.id), detail: `Melepas Owner ${row.name} dari ${row.resto}` });
  res.status(204).end();
});

r.put('/users/:id', async (req, res) => {
  const u = await one(`SELECT * FROM users WHERE id = $1 AND role <> 'superadmin'`, [Number(req.params.id) || 0]);
  if (!u) throw notFound('Pengguna');
  const role = req.body.role === undefined ? u.role : roleOf(req.body.role);
  if ((role === 'owner') !== (u.role === 'owner')) throw bad('Peran Owner tidak bisa ditukar dengan peran lain. Buat akun baru.');
  const name = req.body.name === undefined ? u.name : String(req.body.name).trim();
  const email = req.body.email === undefined ? u.email : String(req.body.email).trim().toLowerCase();
  const active = req.body.is_active === undefined ? u.is_active : !!req.body.is_active;
  if (!name) throw bad('Isi nama');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Email tidak valid');
  await q(`UPDATE users SET role = $2, name = $3, email = $4, is_active = $5, token_version = token_version + CASE WHEN $5 THEN 0 ELSE 1 END WHERE id = $1`,
    [u.id, role, name, email, active]);
  const changes = [u.name !== name && `nama ${u.name} → ${name}`, u.email !== email && `email ${u.email} → ${email}`,
    u.role !== role && `peran ${ROLE_LABEL[u.role as 'central']} → ${ROLE_LABEL[role as 'central']}`, u.is_active !== active && (active ? 'diaktifkan' : 'dinonaktifkan')].filter(Boolean);
  await log(req, { action: 'update', entity: 'user', entityId: u.id, restoId: u.resto_id, detail: `Mengubah akun ${name}${changes.length ? `: ${changes.join(', ')}` : ''}` });
  res.json({ ok: true });
});

// Reset kata sandi: sesi lama pengguna langsung berakhir
r.post('/users/:id/reset-password', async (req, res) => {
  const u = await one(`SELECT * FROM users WHERE id = $1 AND role <> 'superadmin'`, [Number(req.params.id) || 0]);
  if (!u) throw notFound('Pengguna');
  const password = tempPassword();
  await q(`UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1`, [u.id, await bcrypt.hash(password, 10)]);
  await log(req, { action: 'update', entity: 'user', entityId: u.id, restoId: u.resto_id, detail: `Mereset kata sandi ${u.name}` });
  res.json({ password });
});

// ---------- Log aktivitas semua resto ----------
r.get('/logs', async (req, res) => res.json(await logRows(req, req.query.resto_id ? Number(req.query.resto_id) : null)));

export async function logRows(req: Request, restoId: number | null) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (restoId) { params.push(restoId); where.push(`l.resto_id = $${params.length}`); }
  if (req.query.role) { params.push(String(req.query.role)); where.push(`l.user_role = $${params.length}`); }
  if (req.query.action) { params.push(String(req.query.action)); where.push(`l.action = $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from))) { params.push(`${req.query.from}T00:00:00+07:00`); where.push(`l.created_at >= $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to))) { params.push(`${req.query.to}T23:59:59.999+07:00`); where.push(`l.created_at <= $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(l.detail ILIKE $${params.length} OR l.user_name ILIKE $${params.length})`); }
  const page = Math.max(1, Number(req.query.page) || 1), size = 50;
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one(`SELECT count(*)::int n FROM activity_logs l ${w}`, params)).n;
  const data = await q(
    `SELECT l.*, r.name AS resto_name, r.code AS resto_code FROM activity_logs l LEFT JOIN restos r ON r.id = l.resto_id ${w}
      ORDER BY l.created_at DESC, l.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    params,
  );
  return { data, total, page, size };
}

export default r;
