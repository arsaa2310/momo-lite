import { Router } from 'express';
import { one, q } from '../lib/db.ts';
import { restoId } from '../lib/auth.ts';
import { logRows } from './admin.ts';

const r = Router();

// Ringkasan beranda resto: bulan berjalan (WIB) + daftar yang perlu ditindaklanjuti
r.get('/summary', async (req, res) => {
  const rid = restoId(req);
  const month = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  const from = `${month}-01`;
  const s = await one(
    `SELECT
       (SELECT count(*)::int FROM purchase_orders WHERE resto_id = $1 AND status IN ('open', 'partial')) AS po_waiting,
       (SELECT count(*)::int FROM purchase_orders WHERE resto_id = $1 AND payment_terms IS NULL AND status IN ('open', 'partial')) AS po_unset,
       (SELECT COALESCE(sum(l.qty * l.unit_cost * rc.cost_factor), 0) FROM po_receipts rc JOIN po_receipt_lines l ON l.receipt_id = rc.id
          JOIN purchase_orders p ON p.id = rc.purchase_order_id
         WHERE p.resto_id = $1 AND rc.reversed_at IS NULL AND rc.received_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Jakarta') AS po_received_month,
       (SELECT COALESCE(sum(l.qty * l.unit_cost * rc.cost_factor), 0) FROM po_receipts rc JOIN po_receipt_lines l ON l.receipt_id = rc.id
          JOIN purchase_orders p ON p.id = rc.purchase_order_id
         WHERE p.resto_id = $1 AND rc.reversed_at IS NULL AND NOT rc.paid AND p.paid_date IS NULL) AS debt,
       (SELECT COALESCE(sum(total), 0) FROM expenses WHERE resto_id = $1 AND kind = 'daily' AND voided_at IS NULL AND expense_date >= $2) AS daily_month,
       (SELECT COALESCE(sum(total), 0) FROM expenses WHERE resto_id = $1 AND kind = 'employee' AND voided_at IS NULL AND expense_date >= $2) AS employee_month,
       (SELECT count(*)::int FROM items WHERE resto_id = $1 AND deleted_at IS NULL) AS item_count,
       (SELECT count(*)::int FROM suppliers WHERE resto_id = $1 AND deleted_at IS NULL) AS supplier_count,
       (SELECT count(*)::int FROM expense_items WHERE resto_id = $1 AND deleted_at IS NULL) AS expense_item_count`,
    [rid, from],
  );
  const recent = await q(
    `SELECT p.id, p.number, p.status, p.payment_terms, p.created_at, p.expected_date, s.name AS supplier_name,
            (SELECT sum(l.qty * l.unit_cost) FROM purchase_order_lines l WHERE l.purchase_order_id = p.id) AS total
       FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id WHERE p.resto_id = $1 AND p.status IN ('open', 'partial')
      ORDER BY p.expected_date NULLS LAST, p.created_at LIMIT 8`,
    [rid],
  );
  res.json({ month, ...s, waiting: recent });
});

// Log aktivitas resto sendiri (Central Admin)
r.get('/logs', async (req, res) => {
  if (req.s.role !== 'central') return res.status(403).json({ error: 'Anda tidak punya akses ke menu ini' });
  res.json(await logRows(req, restoId(req)));
});

export default r;
