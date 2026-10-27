import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { one, q } from './db.ts';
import { HttpError } from './http.ts';

const SECRET = process.env.JWT_SECRET ?? 'lite-po-dev-secret-ganti-di-production';
export const COOKIE = 'lite_po_session';
export const RESTO_COOKIE = 'lite_po_resto'; // resto yang sedang dibuka Owner

// superadmin: panel admin (membuat resto & akun). owner: pemilik satu / beberapa resto, memantau semuanya.
// central: Central Admin resto. manager: Manager resto (menyetujui PO, pendapatan shift). purchasing: orang PO resto.
export type Role = 'superadmin' | 'owner' | 'central' | 'manager' | 'purchasing';
export const ROLE_LABEL: Record<Role, string> = {
  superadmin: 'Super Admin', owner: 'Owner', central: 'Central Admin', manager: 'Manager', purchasing: 'Purchasing (PO)',
};
export const RESTO_ROLES: Role[] = ['owner', 'central', 'manager', 'purchasing'];
// pengendali keuangan resto: K/T, pelunasan, pembatalan, master data, menyetujui pengeluaran lain
export const ADMIN_ROLES: Role[] = ['central', 'owner'];

// restoId: resto yang sedang dibuka. restoIds: semua resto Owner (resto pengguna lain = satu).
export type Session = { userId: number; name: string; email: string; role: Role; restoId: number | null; restoIds: number[] };

declare global {
  namespace Express {
    interface Request {
      s: Session;
    }
  }
}

export function signSession(userId: number, version: number) {
  return jwt.sign({ sub: userId, v: version }, SECRET, { expiresIn: '7d' });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 24 * 3600e3,
    path: '/',
  });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'Silakan masuk terlebih dahulu');
  let payload: any;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    throw new HttpError(401, 'Sesi berakhir, silakan masuk lagi');
  }
  const u = await one(
    `SELECT u.id, u.name, u.email, u.role, u.resto_id, u.token_version, r.is_active AS resto_active
       FROM users u LEFT JOIN restos r ON r.id = u.resto_id WHERE u.id = $1 AND u.is_active`,
    [Number(payload.sub)],
  );
  if (!u || u.token_version !== Number(payload.v ?? 0)) throw new HttpError(401, 'Sesi berakhir, silakan masuk lagi');
  if (u.resto_id && !u.resto_active) throw new HttpError(401, 'Resto ini sedang dinonaktifkan');
  let restoIds = u.resto_id ? [Number(u.resto_id)] : [];
  let current = u.resto_id ? Number(u.resto_id) : null;
  if (u.role === 'owner') {
    restoIds = (await q(`SELECT o.resto_id FROM owner_restos o JOIN restos r ON r.id = o.resto_id AND r.is_active WHERE o.user_id = $1 ORDER BY r.name`, [u.id]))
      .map((x) => Number(x.resto_id));
    const picked = Number(req.cookies?.[RESTO_COOKIE]);
    current = restoIds.includes(picked) ? picked : restoIds[0] ?? null;
  }
  req.s = { userId: u.id, name: u.name, email: u.email, role: u.role, restoId: current, restoIds };
  next();
}

// Batasi rute ke peran tertentu
export const only = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!roles.includes(req.s.role)) throw new HttpError(403, 'Anda tidak punya akses ke menu ini');
  next();
};

export const isAdmin = (req: Request) => ADMIN_ROLES.includes(req.s.role);

// resto pengguna yang sedang masuk (Owner: resto yang sedang dibuka)
export function restoId(req: Request) {
  if (!req.s.restoId) throw new HttpError(403, req.s.role === 'owner' ? 'Belum ada resto yang terhubung ke akun Owner ini. Hubungi admin.' : 'Menu ini hanya untuk pengguna resto');
  return req.s.restoId;
}
