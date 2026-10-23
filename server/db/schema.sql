-- momo lite PO: pemesanan barang (PO) sampai barang datang & K/T, belanja harian, belanja karyawan, jurnal umum.
-- Tanpa approval. Idempoten: aman dijalankan setiap kali API start.

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

-- superadmin: panel admin (tanpa resto). central: Central Admin resto. purchasing: orang PO resto.
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  resto_id bigint REFERENCES restos(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('superadmin', 'central', 'purchasing')),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  token_version int NOT NULL DEFAULT 0,  -- naik saat kata sandi direset / dinonaktifkan: sesi lama berakhir
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'superadmin') = (resto_id IS NULL))
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
  kind text NOT NULL CHECK (kind IN ('receiving', 'expense', 'payment')),
  mime text NOT NULL,
  size int NOT NULL,
  data bytea NOT NULL,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Purchase Order ============
-- open: menunggu barang, partial: diterima sebagian, received: selesai (semua datang / sisa ditutup), cancelled: dibatalkan sebelum datang
CREATE TABLE IF NOT EXISTS purchase_orders (
  id bigserial PRIMARY KEY,
  resto_id bigint NOT NULL REFERENCES restos(id) ON DELETE CASCADE,
  number text NOT NULL,
  supplier_id bigint NOT NULL REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'received', 'cancelled')),
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
