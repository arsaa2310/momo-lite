-- momo lite PO: pemesanan barang (PO, disetujui Manager) sampai barang datang & K/T, belanja harian & karyawan,
-- pengeluaran lain (input Manager disetujui Central Admin / Owner), pendapatan per shift (input Manager), jurnal umum.
-- Idempoten: aman dijalankan setiap kali API start.

CREATE TABLE IF NOT EXISTS restos (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL,                     -- kode resto di nomor dokumen & kolom Kode jurnal: PO-<code>-00001
  address text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS restos_code_key ON restos (upper(code));

-- superadmin: panel admin (tanpa resto). owner: pemilik satu / beberapa resto (lewat owner_restos, tanpa resto_id).
-- central: Central Admin resto. manager: Manager resto. purchasing: orang PO resto.
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  resto_id bigint REFERENCES restos(id) ON DELETE CASCADE,
  role text NOT NULL CONSTRAINT users_role_v2 CHECK (role IN ('superadmin', 'owner', 'central', 'manager', 'purchasing')),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  token_version int NOT NULL DEFAULT 0,  -- naik saat kata sandi direset / dinonaktifkan: sesi lama berakhir
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_resto_v2 CHECK ((role IN ('superadmin', 'owner')) = (resto_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

-- ============ Master data (diisi Central Admin lewat template Excel) ============
CREATE TABLE IF NOT EXISTS items (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  name text NOT NULL,
  unit text NOT NULL,
  category text,
  sub_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS items_name_key ON items (resto_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS suppliers (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  phone text,
  address text,
  default_terms text CHECK (default_terms IN ('cash', 'credit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_key ON suppliers (resto_id, lower(name)) WHERE deleted_at IS NULL;

-- bahan yang disediakan supplier beserta harga default (harga PO terakhir menggantikannya)
CREATE TABLE IF NOT EXISTS supplier_items (
  supplier_id bigint NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  item_id bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price numeric(14,2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_id, item_id)
);

-- bahan belanja harian (HPP, tidak masuk stok) & belanja karyawan (beban)
CREATE TABLE IF NOT EXISTS expense_items (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('daily', 'employee')),
  name text NOT NULL,
  unit text,
  default_price numeric(14,2),
  category text,
  sub_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_name_key ON expense_items (resto_id, kind, lower(name)) WHERE deleted_at IS NULL;

-- kas & rekening resto (kolom Rekening di jurnal umum)
CREATE TABLE IF NOT EXISTS pay_accounts (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_accounts_name_key ON pay_accounts (resto_id, lower(name)) WHERE deleted_at IS NULL;

-- ============ Foto (dikompres di browser, disimpan di database) ============
CREATE TABLE IF NOT EXISTS uploads (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  kind text NOT NULL CONSTRAINT uploads_kind_v2 CHECK (kind IN ('receiving', 'expense', 'payment', 'revenue')),
  mime text NOT NULL,
  size int NOT NULL,
  data bytea NOT NULL,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Purchase Order ============
-- approval: menunggu persetujuan Manager / Owner (PO buatan Purchasing), rejected: ditolak,
-- open: menunggu barang, partial: diterima sebagian, received: selesai (semua datang / sisa ditutup), cancelled: dibatalkan sebelum datang
CREATE TABLE IF NOT EXISTS purchase_orders (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  number text NOT NULL,
  supplier_id bigint NOT NULL REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'open' CONSTRAINT purchase_orders_status_v2 CHECK (status IN ('approval', 'rejected', 'open', 'partial', 'received', 'cancelled')),
  notes text,
  expected_date date,
  -- K/T: credit = K (kredit / hutang, PKH), cash = T (tunai, PTH). NULL = belum ditentukan.
  payment_terms text CHECK (payment_terms IN ('cash', 'credit')),
  terms_by_central boolean NOT NULL DEFAULT false,  -- ditetapkan Central Admin: penerima tidak bisa mengubah
  due_date date,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  closed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  close_note text,
  -- pelunasan hutang (PKH) oleh Central Admin
  paid_date date,
  paid_account_id bigint REFERENCES pay_accounts(id),
  paid_by bigint REFERENCES users(id) ON DELETE SET NULL,
  paid_photo_id bigint REFERENCES uploads(id),
  UNIQUE (resto_id, number)
);
CREATE INDEX IF NOT EXISTS purchase_orders_resto_created ON purchase_orders (resto_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id bigserial PRIMARY KEY,
  purchase_order_id bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id bigint NOT NULL REFERENCES items(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  received_qty numeric(14,3) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_po ON purchase_order_lines (purchase_order_id);

-- setiap kedatangan barang: PO-XXX-00001/1, /2, ... (penerimaan sebagian), wajib foto barang & foto nota
CREATE TABLE IF NOT EXISTS po_receipts (
  id bigserial PRIMARY KEY,
  purchase_order_id bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  number text NOT NULL,
  received_by bigint REFERENCES users(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  goods_photo_id bigint NOT NULL REFERENCES uploads(id),
  receipt_photo_id bigint NOT NULL REFERENCES uploads(id),
  extra_photo_ids bigint[] NOT NULL DEFAULT '{}',
  paid boolean NOT NULL,                      -- T: lunas saat datang (PTH); K: hutang (PKH)
  pay_account_id bigint REFERENCES pay_accounts(id),
  ppn numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  cost_factor numeric(12,8) NOT NULL DEFAULT 1, -- (bruto − diskon + PPN) / bruto
  notes text,
  excess_note text,                           -- wajib bila jumlah datang melebihi pesanan
  price_note text,                            -- wajib bila harga nota berbeda dari harga PO
  reversed_at timestamptz,                    -- dibatalkan Central Admin (salah input)
  reversed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  reverse_note text
);
CREATE INDEX IF NOT EXISTS po_receipts_po ON po_receipts (purchase_order_id);

CREATE TABLE IF NOT EXISTS po_receipt_lines (
  id bigserial PRIMARY KEY,
  receipt_id bigint NOT NULL REFERENCES po_receipts(id) ON DELETE CASCADE,
  po_line_id bigint NOT NULL REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),  -- termasuk kelebihan
  excess_qty numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost numeric(14,2) NOT NULL,            -- harga yang dipakai (harga nota bila berbeda)
  po_unit_cost numeric(14,2) NOT NULL
);

-- ============ Belanja harian & belanja karyawan (tanpa supplier terdaftar, tidak masuk stok, wajib foto nota) ============
CREATE TABLE IF NOT EXISTS expenses (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('daily', 'employee')),
  number text NOT NULL,
  expense_date date NOT NULL,
  supplier_name text,                          -- nama toko / pasar (opsional)
  pay_account_id bigint REFERENCES pay_accounts(id),
  total numeric(14,2) NOT NULL,
  receipt_photo_id bigint NOT NULL REFERENCES uploads(id),
  extra_photo_ids bigint[] NOT NULL DEFAULT '{}',
  notes text,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,                       -- dibatalkan Central Admin
  voided_by bigint REFERENCES users(id) ON DELETE SET NULL,
  void_note text,
  UNIQUE (resto_id, number)
);
CREATE INDEX IF NOT EXISTS expenses_resto_date ON expenses (resto_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS expense_lines (
  id bigserial PRIMARY KEY,
  expense_id bigint NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  item_id bigint REFERENCES expense_items(id),
  name text NOT NULL,
  unit text,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  category text,
  sub_category text
);

-- ============ Log aktivitas ============
CREATE TABLE IF NOT EXISTS activity_logs (
  id bigserial PRIMARY KEY,
  resto_id bigint REFERENCES restos(id) ON DELETE CASCADE,
  user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  user_name text,
  user_role text,
  action text NOT NULL,       -- login, create, update, delete, receive, terms, import, ...
  entity text,                -- po, receipt, expense, master, user, resto
  entity_id bigint,
  detail text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_logs_resto_created ON activity_logs (resto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_entity ON activity_logs (entity, entity_id);

-- ============ v2: Owner & Manager, persetujuan PO, pengeluaran lain, pendapatan shift ============
-- Database lama: ganti CHECK peran / status / jenis foto ke versi baru (sekali saja)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_v2') THEN
    EXECUTE COALESCE((SELECT string_agg(format('ALTER TABLE users DROP CONSTRAINT %I', conname), '; ')
                        FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c'), 'SELECT 1');
    ALTER TABLE users ADD CONSTRAINT users_role_v2 CHECK (role IN ('superadmin', 'owner', 'central', 'manager', 'purchasing'));
    ALTER TABLE users ADD CONSTRAINT users_resto_v2 CHECK ((role IN ('superadmin', 'owner')) = (resto_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_status_v2') THEN
    ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_v2 CHECK (status IN ('approval', 'rejected', 'open', 'partial', 'received', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploads_kind_v2') THEN
    ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_kind_check;
    ALTER TABLE uploads ADD CONSTRAINT uploads_kind_v2 CHECK (kind IN ('receiving', 'expense', 'payment', 'revenue'));
  END IF;
END $$;

-- Owner ↔ resto yang dimilikinya (diatur Super Admin)
CREATE TABLE IF NOT EXISTS owner_restos (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, resto_id)
);
CREATE INDEX IF NOT EXISTS owner_restos_resto ON owner_restos (resto_id);

-- Nama shift laporan pendapatan, diatur Owner. Satu nama saja (mis. Harian) = laporan per hari.
ALTER TABLE restos ADD COLUMN IF NOT EXISTS shift_names text[] NOT NULL DEFAULT '{Harian}';

-- Persetujuan PO buatan Purchasing (Manager / Owner). PO buatan Manager, Central Admin, Owner langsung disetujui.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by bigint REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reject_note text;

-- ============ Pengeluaran lain (listrik, gas, servis, sewa, …) ============
-- Input Manager → menunggu persetujuan Central Admin / Owner. Input Central Admin / Owner langsung disetujui.
-- Tunai (PTH) dari kas / rekening, wajib foto nota. Masuk jurnal umum setelah disetujui.
CREATE TABLE IF NOT EXISTS other_expenses (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  number text NOT NULL,                        -- PL-KODE-00001
  expense_date date NOT NULL,
  payee text NOT NULL,                         -- dibayar ke (PLN, toko, tukang, …)
  pay_account_id bigint NOT NULL REFERENCES pay_accounts(id),
  total numeric(14,2) NOT NULL,
  receipt_photo_id bigint NOT NULL REFERENCES uploads(id),
  extra_photo_ids bigint[] NOT NULL DEFAULT '{}',
  notes text,
  status text NOT NULL DEFAULT 'approval' CHECK (status IN ('approval', 'approved', 'rejected', 'void')),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by bigint REFERENCES users(id) ON DELETE SET NULL,   -- menyetujui / menolak
  decided_at timestamptz,
  decide_note text,
  voided_by bigint REFERENCES users(id) ON DELETE SET NULL,    -- dibatalkan setelah disetujui (salah input)
  voided_at timestamptz,
  void_note text,
  UNIQUE (resto_id, number)
);
CREATE INDEX IF NOT EXISTS other_expenses_resto_date ON other_expenses (resto_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS other_expense_lines (
  id bigserial PRIMARY KEY,
  expense_id bigint NOT NULL REFERENCES other_expenses(id) ON DELETE CASCADE,
  description text NOT NULL,
  category text NOT NULL,
  sub_category text,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit text,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS other_expense_lines_expense ON other_expense_lines (expense_id);

-- ============ Pendapatan per shift (input Manager) ============
-- Metode bayar pendapatan (Tunai, QRIS, …) & kas / rekening tempat uangnya masuk
CREATE TABLE IF NOT EXISTS revenue_methods (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  name text NOT NULL,
  pay_account_id bigint REFERENCES pay_accounts(id),
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS revenue_methods_name_key ON revenue_methods (resto_id, lower(name)) WHERE deleted_at IS NULL;
-- metode bawaan untuk resto yang belum pernah punya
INSERT INTO revenue_methods (resto_id, name, sort, pay_account_id)
SELECT r.id, m.name, m.sort,
       CASE WHEN m.sort = 1 THEN (SELECT pa.id FROM pay_accounts pa WHERE pa.resto_id = r.id AND pa.deleted_at IS NULL ORDER BY pa.id LIMIT 1) END
  FROM restos r
 CROSS JOIN (VALUES ('Tunai', 1), ('QRIS', 2), ('Debit / Kartu', 3), ('Transfer', 4), ('Ojol / Online', 5)) AS m(name, sort)
 WHERE NOT EXISTS (SELECT 1 FROM revenue_methods x WHERE x.resto_id = r.id);

-- submitted: dicatat Manager (masih bisa dikoreksi), verified: dicek & dikunci Central Admin / Owner, void: dibatalkan
CREATE TABLE IF NOT EXISTS revenue_reports (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  number text NOT NULL,                        -- PD-KODE-00001
  report_date date NOT NULL,
  shift text NOT NULL,
  total numeric(14,2) NOT NULL,
  trx_count int,                               -- jumlah transaksi / nota (opsional)
  notes text,
  photo_ids bigint[] NOT NULL DEFAULT '{}',    -- foto laporan kasir / bukti setor (opsional)
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'verified', 'void')),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz,
  verified_by bigint REFERENCES users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  voided_by bigint REFERENCES users(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_note text,
  UNIQUE (resto_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS revenue_reports_shift_key ON revenue_reports (resto_id, report_date, lower(shift)) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS revenue_reports_resto_date ON revenue_reports (resto_id, report_date DESC);

CREATE TABLE IF NOT EXISTS revenue_report_lines (
  id bigserial PRIMARY KEY,
  report_id bigint NOT NULL REFERENCES revenue_reports(id) ON DELETE CASCADE,
  method_id bigint REFERENCES revenue_methods(id),
  method_name text NOT NULL,
  pay_account_id bigint REFERENCES pay_accounts(id),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS revenue_report_lines_report ON revenue_report_lines (report_id);
