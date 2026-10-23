import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { one } from './db.ts';
import { HttpError } from './http.ts';

const SECRET = process.env.JWT_SECRET ?? 'lite-po-dev-secret-ganti-di-production';
export const COOKIE = 'lite_po_session';

// superadmin: panel admin (membuat resto & akun). central: Central Admin resto. purchasing: orang PO resto.
export type Role = 'superadmin' | 'central' | 'purchasing';
export const ROLE_LABEL: Record<Role, string> = { superadmin: 'Super Admin', central: 'Central Admin', purchasing: 'Purchasing (PO)' };

export type Session = { userId: number; name: string; email: string; role: Role; restoId: number | null };

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
  req.s = { userId: u.id, name: u.name, email: u.email, role: u.role, restoId: u.resto_id };
  next();
}

// Batasi rute ke peran tertentu
export const only = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!roles.includes(req.s.role)) throw new HttpError(403, 'Anda tidak punya akses ke menu ini');
  next();
};

// resto pengguna yang sedang masuk (central / purchasing)
export function restoId(req: Request) {
  if (!req.s.restoId) throw new HttpError(403, 'Menu ini hanya untuk pengguna resto');
  return req.s.restoId;
}
