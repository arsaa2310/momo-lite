# momo lite PO

Versi ringan dari modul pembelian momo (`get_web_sango/erp/momo`) — aplikasi **terpisah** (database, port, container
sendiri); kode momo utama tidak diubah. **Tanpa approval**: setiap input langsung tercatat.

Isi: Purchase Order sampai barang datang & penentuan K/T · Belanja Harian · Belanja Karyawan · Master data lewat
template Excel · Jurnal Umum + ekspor Excel · Panel admin & log aktivitas.

## Menjalankan

```bash
cp .env.example .env                  # opsional
docker compose up -d --build          # db (5434) + api + web (8095)
docker compose exec api npm run seed:demo   # opsional: resto demo
```

Buka **http://localhost:8095**.

| Akun | Email | Kata sandi |
|---|---|---|
| Super Admin | `admin@lite.id` (env `ADMIN_EMAIL`) | `admin12345` (env `ADMIN_PASSWORD`) |
| Central Admin (demo) | `central@lite.id` | `lite1234` |
| Purchasing (demo) | `po@lite.id` | `lite1234` |

## Peran

| Peran | Bisa |
|---|---|
| **Super Admin** (panel admin) | 1) membuat resto (nama + kode), 2) mendaftarkan Central Admin & orang PO tiap resto (kata sandi awal, reset, nonaktifkan), 3) melihat log aktivitas semua resto |
| **Central Admin** | Master data lewat form web (satu per satu) atau template Excel; melihat **semua** PO, kedatangan (foto barang, nota, foto tambahan), belanja & notanya; menetapkan **K/T** dan jatuh tempo; melunasi hutang (K); membatalkan kedatangan / belanja yang salah input; **Jurnal Umum** + ekspor Excel; log resto |
| **Purchasing (orang PO)** | Membuat PO, menerima barang, mencatat belanja harian & karyawan |

## Alur PO

1. Purchasing membuat PO: pilih bahan → supplier (harga dari master, termurah dulu, boleh diubah). Satu form boleh
   beberapa supplier → otomatis **satu PO per supplier** (`PO-KODE-00001`). Harga PO menjadi harga terbaru supplier itu.
2. **K/T**: Central Admin menetapkan K (kredit/hutang → PKH) atau T (tunai → PTH); terkunci untuk penerima. Bila belum
   diatur, penerima memilih K/T saat barang pertama datang. Setelah barang datang hanya Central Admin yang bisa
   mengubahnya (status bayar kedatangan ikut berubah) selama hutang belum dilunasi.
3. **Terima barang** (boleh sebagian: `PO-KODE-00001/1`, `/2`, …): **wajib foto barang & foto nota**, foto tambahan
   opsional (maks. 6), semua dikompres di HP/browser. Kelebihan barang & harga nota yang berbeda langsung dicatat dengan
   catatan wajib. PPN & diskon nota opsional. T → pilih kas/rekening.
4. PO selesai bila semua barang datang, atau **tutup sisa** manual. PO yang belum ada barang datang bisa dibatalkan.
5. Hutang (K) dilunasi Central Admin (tanggal, rekening, bukti opsional) → kolom Tanggal Bayar & Rekening jurnal.

## Belanja harian & karyawan

Dari daftar bahan Central Admin (sheet *Bahan Belanja*), tidak masuk persediaan, nama toko opsional, dibayar dari
kas/rekening, **wajib foto nota**. Nomor `BH-KODE-00001` / `BK-KODE-00001`. Masuk jurnal sebagai PTH.

## Master data (form web atau template Excel)

**Satu per satu dari web**: Master Data → tombol **Tambah …** di tiap tab, atau klik baris untuk mengubah. Form bahan PO
sekaligus berisi daftar supplier & harganya; form supplier berisi bahan yang dijualnya & harga; ada juga form harga
supplier, bahan belanja (Harian/Karyawan, kategori bawaan bila dikosongkan), dan rekening. Aturan sama dengan impor:
nama unik, satuan bahan tidak bisa diubah setelah pernah dipesan.

**Banyak sekaligus lewat Excel**: Master Data → **Template kosong** / **Unduh data saat ini** → isi → **Impor Excel**. Sheet: *Bahan PO*, *Supplier*
(termin default K/T), *Harga Supplier* (dropdown dari dua sheet sebelumnya), *Bahan Belanja* (Harian/Karyawan),
*Rekening*, plus *Petunjuk*. Impor selalu menampilkan **pratinjau** (baru / diubah / sama) dan kesalahan per baris;
disimpan hanya bila semua baris benar. Dicocokkan berdasarkan nama; baris yang tidak ada di file tidak dihapus;
kolom opsional kosong tidak menimpa nilai lama; baris "Contoh:" diabaikan.

## Jurnal Umum

Format kolom sama dengan momo: Tanggal, Term (PTH/PKH), Kode, Supplier, Barang, Sub Kategori, Kategori, Qty, Unit,
Harga, PPN, Sub Total, Diskon, TOTAL (per hari + term), Tanggal Bayar, Rekening, CR/DB, No. Dokumen.
Ekspor Excel berisi sheet *Jurnal Umum* (dengan total PTH/PKH/belum dibayar) dan *Rekap Kategori*.

## Perbaikan harga tanpa ribuan

Harga yang tertulis tanpa ribuan (mis. `17` maksudnya `17.000`) bisa dikali 1.000 sekaligus:

```bash
docker compose exec api npm run fix:prices              # pratinjau, tidak mengubah apa pun
docker compose exec api npm run fix:prices -- --apply   # simpan
```

Yang diubah: harga supplier, harga default bahan belanja, dan harga baris PO yang belum ada barang datang. Bahan bersatuan
kecil (gram, ml) dilewati; PO yang barangnya sudah datang hanya ditampilkan untuk dicek manual. Di form, harga di bawah
Rp1.000 menampilkan saran "maksudnya Rp17.000?".

## Pengembangan lokal

```bash
docker compose up -d db
cd server && npm install && npm run migrate && npm run dev     # API :4500 (DATABASE_URL default ke localhost:5434)
cd web && npm install && npm run dev                            # http://localhost:5190
```

Struktur: `server/db/schema.sql` (skema idempoten), `server/src/routes/` (`admin`, `master`, `po`, `expenses`,
`journal`, `uploads`, `summary`), `web/src/pages/`.
