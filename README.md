# momo lite PO

Versi ringan dari modul pembelian momo (`get_web_sango/erp/momo`) — aplikasi **terpisah** (database, port, container
sendiri); kode momo utama tidak diubah.

Isi: Purchase Order (disetujui Manager) sampai barang datang & penentuan K/T · Belanja Harian · Belanja Karyawan ·
Pengeluaran Lain (disetujui Central Admin / Owner) · Pendapatan per shift (input Manager) · Master data lewat template
Excel · Jurnal Umum (uang masuk & keluar) + ekspor Excel · Ringkasan Owner semua resto · Panel admin & log aktivitas.

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
| Owner (demo) | `owner@lite.id` | `lite1234` |
| Central Admin (demo) | `central@lite.id` | `lite1234` |
| Manager (demo) | `manager@lite.id` | `lite1234` |
| Purchasing (demo) | `po@lite.id` | `lite1234` |

`npm run seed:demo` pada database lama yang sudah punya resto DMO hanya menambahkan akun Owner & Manager demo.

## Peran

| Peran | Bisa |
|---|---|
| **Super Admin** (panel admin) | 1) membuat resto (nama + kode), 2) mendaftarkan Owner, Central Admin, Manager & orang PO tiap resto (kata sandi awal, reset, nonaktifkan; Owner yang sama bisa ditautkan ke beberapa resto), 3) melihat log aktivitas semua resto |
| **Owner** | Semua yang bisa dilakukan Central Admin, ditambah: menu **Semua Resto** (uang masuk/keluar, yang menunggu persetujuan, kelengkapan laporan shift setiap resto), **kinerja tim**, pindah resto di sidebar, menyetujui / menolak PO, dan mengatur **shift** laporan pendapatan |
| **Central Admin** | Master data lewat form web (satu per satu) atau template Excel; melihat **semua** PO, kedatangan (foto barang, nota, foto tambahan), belanja & notanya; menetapkan **K/T** dan jatuh tempo; melunasi hutang (K); membatalkan kedatangan / belanja yang salah input; **menyetujui pengeluaran lain** dari Manager; mengecek & mengunci laporan pendapatan; **Jurnal Umum** + ekspor Excel; log resto |
| **Manager** | **Menyetujui / menolak PO** buatan Purchasing; membuat PO (langsung disetujui) & menerima barang; mengisi **pendapatan setiap akhir shift**; mengajukan **pengeluaran lain**; mencatat belanja; memantau beranda & Jurnal Umum |
| **Purchasing (orang PO)** | Membuat PO (menunggu persetujuan Manager), menerima barang, mencatat belanja harian & karyawan |

## Alur PO

1. Purchasing membuat PO: pilih bahan → supplier (harga dari master, termurah dulu, boleh diubah). Satu form boleh
   beberapa supplier → otomatis **satu PO per supplier** (`PO-KODE-00001`). PO buatan Purchasing **menunggu persetujuan
   Manager / Owner** (boleh ditolak dengan alasan); barang baru bisa diterima setelah disetujui. PO buatan Manager,
   Central Admin, atau Owner langsung disetujui. Harga PO yang disetujui menjadi harga terbaru supplier itu.
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

## Pengeluaran lain

Listrik, gas, air, servis, sewa, dan biaya lain di luar PO & belanja — hanya Manager, Central Admin, Owner. Isi: dibayar
ke, kas/rekening, baris keterangan + kategori (saran bawaan seperti *Beban Listrik*, boleh diketik bebas) + nominal,
**wajib foto nota**. Nomor `PL-KODE-00001`. Input **Manager menunggu persetujuan Central Admin / Owner** (setujui / tolak
dengan alasan; Manager bisa menarik pengajuannya); input Central Admin / Owner langsung disetujui. Masuk jurnal sebagai PTH
setelah disetujui; yang sudah disetujui bisa dibatalkan Central Admin / Owner.

## Pendapatan shift

Manager mengisi uang masuk setiap akhir shift, dirinci **per metode bayar** (Tunai, QRIS, Debit / Kartu, Transfer,
Ojol / Online — diatur di Master Data → *Metode Pendapatan*, masing-masing bisa ditautkan ke kas/rekening tujuan),
plus jumlah transaksi, catatan, dan foto laporan kasir (opsional). Nomor `PD-KODE-00001`. **Nama shift diatur Owner**
(menu Semua Resto → Shift): cukup satu (mis. *Harian*) bila laporannya per hari, atau beberapa (Pagi, Malam). Satu
laporan per tanggal + shift; halaman menampilkan shift 7 hari terakhir yang belum dilaporkan. Manager bisa mengoreksi
sampai Central Admin / Owner **mengecek & mengunci** laporan (kunci bisa dibuka lagi; laporan bisa dibatalkan dengan alasan).

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

Dilihat Central Admin, Owner, Manager. Term: **PNDPTN** (pendapatan shift, satu baris per metode bayar, DB), **PTH**
(PO tunai, belanja harian & karyawan, pengeluaran lain), **PKH** (PO kredit). Ringkasan: uang masuk, uang keluar yang sudah
dibayar, hutang belum dibayar, dan **selisih kas** (masuk − keluar dibayar). Format kolom sama dengan momo: Tanggal, Term, Kode, Supplier, Barang, Sub Kategori, Kategori, Qty, Unit,
Harga, PPN, Sub Total, Diskon, TOTAL (per hari + term), Tanggal Bayar, Rekening, CR/DB, No. Dokumen.
Ekspor Excel berisi sheet *Jurnal Umum* (dengan total PNDPTN/PTH/PKH/belum dibayar/selisih) dan *Rekap Kategori*
(pengeluaran per kategori + pendapatan per metode).

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

Struktur: `server/db/schema.sql` (skema idempoten; database lama otomatis diperbarui saat API start),
`server/src/routes/` (`admin`, `master`, `po`, `expenses`, `other`, `revenue`, `journal`, `uploads`, `summary`, `owner`),
`web/src/pages/`.
