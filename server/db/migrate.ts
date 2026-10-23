import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { pool, one } from '../src/lib/db.ts';

// Skema idempoten (CREATE ... IF NOT EXISTS) + Super Admin pertama dari env bila belum ada.
await pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

if (!(await one(`SELECT 1 AS ok FROM users WHERE role = 'superadmin'`))) {
  const email = process.env.ADMIN_EMAIL ?? 'admin@lite.id';
  const password = process.env.ADMIN_PASSWORD ?? 'admin12345';
  await pool.query(`INSERT INTO users (role, name, email, password_hash) VALUES ('superadmin', 'Super Admin', $1, $2)`, [email.toLowerCase(), await bcrypt.hash(password, 10)]);
  console.log(`Super Admin dibuat: ${email}`);
}
console.log('Database siap.');
await pool.end();
