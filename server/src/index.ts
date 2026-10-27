import express from 'express';
import cookieParser from 'cookie-parser';
import { RESTO_ROLES, requireAuth, only } from './lib/auth.ts';
import { errorHandler } from './lib/http.ts';
import auth from './routes/auth.ts';
import admin from './routes/admin.ts';
import master from './routes/master.ts';
import po from './routes/po.ts';
import expenses from './routes/expenses.ts';
import journal from './routes/journal.ts';
import uploads from './routes/uploads.ts';
import summary from './routes/summary.ts';
import revenue from './routes/revenue.ts';
import other from './routes/other.ts';
import owner from './routes/owner.ts';

const app = express();
app.disable('x-powered-by');
// Di balik nginx: IP pengguna asli dibaca dari X-Forwarded-For untuk log aktivitas.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
// foto (data URL terkompres) & file Excel impor lebih besar dari body JSON biasa
app.use(['/api/uploads', '/api/master/import'], express.json({ limit: '6mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', auth);
app.use('/api', requireAuth);
app.use('/api/admin', admin);
app.use('/api/owner', owner);
// menu resto: Owner, Central Admin, Manager, Purchasing (hak per menu diatur di masing-masing rute)
app.use('/api', only(...RESTO_ROLES), master, po, expenses, other, revenue, journal, uploads, summary);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4500);
app.listen(port, () => console.log(`lite PO API di http://localhost:${port}`));
