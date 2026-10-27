import { Router, type Request } from 'express';
import { one, q } from '../lib/db.ts';
import { HttpError } from '../lib/http.ts';
import { isAdmin, restoId } from '../lib/auth.ts';
import { logRows } from './admin.ts';

const r = Router();

const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

// Angka uang masuk / keluar satu resto untuk periode (tanggal WIB). Dipakai beranda resto & ringkasan Owner.
export async function moneyFlow(rid: number, from: string, to: string) {
  const x = await one(
    `SELECT
       (SELECT COALESCE(sum(total), 0) FROM revenue_reports WHERE resto_id = $1 AND status <> 'void' AND report_date BETWEEN $2 AND $3) AS revenue,
       (SELECT COALESCE(sum(l.qty * l.unit_cost * rc.cost_factor), 0) FROM po_receipts rc JOIN po_receipt_lines l ON l.receipt_id = rc.id
          JOIN purchase_orders p ON p.id = rc.purchase_order_id
         WHERE p.resto_id = $1 AND rc.reversed_at IS NULL
           AND rc.received_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Jakarta' AND rc.received_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') AS po_received,
       (SELECT COALESCE(sum(total), 0) FROM expenses WHERE resto_id = $1 AND kind = 'daily' AND voided_at IS NULL AND expense_date BETWEEN $2 AND $3) AS daily,
       (SELECT COALESCE(sum(total), 0) FROM expenses WHERE resto_id = $1 AND kind = 'employee' AND voided_at IS NULL AND expense_date BETWEEN $2 AND $3) AS employee,
       (SELECT COALESCE(sum(total), 0) FROM other_expenses WHERE resto_id = $1 AND status = 'approved' AND expense_date BETWEEN $2 AND $3) AS other,
       (SELECT COALESCE(sum(l.qty * l.unit_cost * rc.cost_factor), 0) FROM po_receipts rc JOIN po_receipt_lines l ON l.receipt_id = rc.id
          JOIN purchase_orders p ON p.id = rc.purchase_order_id
         WHERE p.resto_id = $1 AND rc.reversed_at IS NULL AND NOT rc.paid AND p.paid_date IS NULL) AS debt`,
    [rid, from, to],
  );
  const spending = Number(x.po_received) + Number(x.daily) + Number(x.employee) + Number(x.other);
  return { ...x, spending, net: Number(x.revenue) - spending };
}

// Hal yang menunggu tindakan di satu resto
export async function pending(rid: number) {
  return one(
    `SELECT
       (SELECT count(*)::int FROM purchase_orders WHERE resto_id = $1 AND status = 'approval') AS po_approval,
       (SELECT count(*)::int FROM purchase_orders WHERE resto_id = $1 AND status IN ('open', 'partial')) AS po_waiting,
       (SELECT count(*)::int FROM purchase_orders WHERE resto_id = $1 AND payment_terms IS NULL AND status IN ('open', 'partial')) AS po_unset,
       (SELECT count(*)::int FROM other_expenses WHERE resto_id = $1 AND status = 'approval') AS other_approval,
       (SELECT count(*)::int FROM revenue_reports WHERE resto_id = $1 AND status = 'submitted') AS revenue_unverified`,
    [rid],
  );
}

// Shift hari ini yang belum dilaporkan
async function missingShifts(rid: number, date: string) {
  const resto = await one(`SELECT shift_names FROM restos WHERE id = $1`, [rid]);
  const done = new Set((await q(`SELECT lower(shift) AS s FROM revenue_reports WHERE resto_id = $1 AND report_date = $2 AND status <> 'void'`, [rid, date])).map((x) => x.s));
  return (resto.shift_names as string[]).filter((s) => !done.has(s.toLowerCase()));
}

// Ringkasan beranda resto: bulan berjalan (WIB) + daftar yang perlu ditindaklanjuti
r.get('/summary', async (req, res) => {
  const rid = restoId(req);
  const month = today().slice(0, 7);
  const from = `${month}-01`;
  const [flow, wait, s, missing] = await Promise.all([
    moneyFlow(rid, from, today()),
    pending(rid),
    one(
      `SELECT (SELECT count(*)::int FROM items WHERE resto_id = $1 AND deleted_at IS NULL) AS item_count,
              (SELECT count(*)::int FROM suppliers WHERE resto_id = $1 AND deleted_at IS NULL) AS supplier_count,
              (SELECT count(*)::int FROM expense_items WHERE resto_id = $1 AND deleted_at IS NULL) AS expense_item_count`, [rid]),
    missingShifts(rid, today()),
  ]);
  const recent = await q(
    `SELECT p.id, p.number, p.status, p.payment_terms, p.created_at, p.expected_date, s.name AS supplier_name, u.name AS created_by_name,
            (SELECT sum(l.qty * l.unit_cost) FROM purchase_order_lines l WHERE l.purchase_order_id = p.id) AS total
       FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.created_by
      WHERE p.resto_id = $1 AND p.status IN ('approval', 'open', 'partial')
      ORDER BY p.status = 'approval' DESC, p.expected_date NULLS LAST, p.created_at LIMIT 10`,
    [rid],
  );
  res.json({
    month, ...s, ...wait, missing_shifts: missing,
    po_received_month: flow.po_received, debt: flow.debt, daily_month: flow.daily, employee_month: flow.employee, other_month: flow.other,
    revenue_month: flow.revenue, spending_month: flow.spending, net_month: flow.net, waiting: recent,
  });
});

// Kinerja tim satu resto dalam periode: siapa mengerjakan apa (Owner, Central Admin, Manager)
export async function teamRows(rid: number, from: string, to: string) {
  const F = `($2::date)::timestamp AT TIME ZONE 'Asia/Jakarta'`, T = `($3::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'`;
  return q(
    `WITH people AS (
       SELECT u.id, u.name, u.role, u.is_active, u.last_login_at FROM users u WHERE u.resto_id = $1
       UNION SELECT u.id, u.name, u.role, u.is_active, u.last_login_at FROM users u JOIN owner_restos o ON o.user_id = u.id WHERE o.resto_id = $1)
     SELECT p.*,
       (SELECT count(*)::int FROM purchase_orders x WHERE x.resto_id = $1 AND x.created_by = p.id AND x.created_at >= ${F} AND x.created_at < ${T}) AS po_created,
       (SELECT count(*)::int FROM purchase_orders x WHERE x.resto_id = $1 AND x.approved_by = p.id AND x.created_by <> p.id AND x.approved_at >= ${F} AND x.approved_at < ${T}) AS po_decided,
       (SELECT count(*)::int FROM po_receipts rc JOIN purchase_orders x ON x.id = rc.purchase_order_id
         WHERE x.resto_id = $1 AND rc.received_by = p.id AND rc.reversed_at IS NULL AND rc.received_at >= ${F} AND rc.received_at < ${T}) AS receipts,
       (SELECT count(*)::int FROM expenses x WHERE x.resto_id = $1 AND x.created_by = p.id AND x.voided_at IS NULL AND x.expense_date BETWEEN $2 AND $3) AS expenses,
       (SELECT COALESCE(sum(x.total), 0) FROM expenses x WHERE x.resto_id = $1 AND x.created_by = p.id AND x.voided_at IS NULL AND x.expense_date BETWEEN $2 AND $3) AS expenses_value,
       (SELECT count(*)::int FROM other_expenses x WHERE x.resto_id = $1 AND x.created_by = p.id AND x.expense_date BETWEEN $2 AND $3) AS other,
       (SELECT count(*)::int FROM revenue_reports x WHERE x.resto_id = $1 AND x.created_by = p.id AND x.status <> 'void' AND x.report_date BETWEEN $2 AND $3) AS revenue_reports,
       (SELECT count(*)::int FROM activity_logs l WHERE l.resto_id = $1 AND l.user_id = p.id AND l.created_at >= ${F} AND l.created_at < ${T}) AS activities,
       (SELECT max(l.created_at) FROM activity_logs l WHERE l.resto_id = $1 AND l.user_id = p.id) AS last_activity
     FROM people p
     ORDER BY CASE p.role WHEN 'owner' THEN 0 WHEN 'central' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, p.name`,
    [rid, from, to],
  );
}

export function periodOf(req: Request) {
  const t = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : `${t.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : t;
  return { from, to };
}

r.get('/summary/team', async (req, res) => {
  if (req.s.role === 'purchasing') throw new HttpError(403, 'Anda tidak punya akses ke menu ini');
  const { from, to } = periodOf(req);
  res.json({ from, to, rows: await teamRows(restoId(req), from, to) });
});

// Log aktivitas resto sendiri (Central Admin / Owner)
r.get('/logs', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Anda tidak punya akses ke menu ini' });
  res.json(await logRows(req, restoId(req)));
});

export default r;
