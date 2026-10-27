import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, FileSpreadsheet, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, download } from '../api';
import { useApi, useAction } from '../ui/hooks';
import { useToast } from '../ui/toast';
import { Badge, Confirm, Empty, Field, Input, Loading, Money, PageHead, SearchBox, Seg, Select, Sheet, Tabs, ThousandHint } from '../ui/kit';
import { date, qty as fq, rp } from '../format';

type Tab = 'items' | 'suppliers' | 'prices' | 'expense' | 'accounts' | 'methods';
const TABS: { value: Tab; label: string }[] = [
  { value: 'items', label: 'Bahan PO' }, { value: 'suppliers', label: 'Supplier' }, { value: 'prices', label: 'Harga Supplier' },
  { value: 'expense', label: 'Bahan Belanja' }, { value: 'accounts', label: 'Rekening' }, { value: 'methods', label: 'Metode Pendapatan' },
];
const ADD_LABEL: Record<Tab, string> = { items: 'Tambah bahan PO', suppliers: 'Tambah supplier', prices: 'Tambah harga supplier', expense: 'Tambah bahan belanja', accounts: 'Tambah rekening', methods: 'Tambah metode' };
const UNITS = ['kg', 'gram', 'liter', 'ml', 'pcs', 'pack', 'dus', 'karung', 'ikat', 'butir', 'botol', 'kaleng', 'sachet', 'paket'];
const EXPENSE_DEFAULT = {
  daily: { category: '2.1 Biaya Bahan Baku Produksi', sub_category: 'Bahan Harian' },
  employee: { category: '3.6 Biaya Natura', sub_category: 'Masak Karyawan' },
};
const INVALIDATE = ['/master', '/logs', '/summary', '/revenue', '/journal'];

// Central Admin mengisi master data: satu per satu lewat form, atau banyak sekaligus lewat template Excel.
export default function Master() {
  const [tab, setTab] = useState<Tab>('items');
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState<{ tab: Tab; row: any } | null>(null);
  const toast = useToast();
  const dl = async (filled: boolean) => {
    try { await download(`/master/template${filled ? '?filled=1' : ''}`, 'template-master.xlsx'); } catch (e: any) { toast(e.message, true); }
  };
  const edit = (row: any) => setForm({ tab, row });
  return (
    <>
      <PageHead title="Master Data" sub="Bahan PO, supplier & harganya, bahan belanja harian/karyawan, rekening, dan metode pendapatan — isi satu per satu lewat form, atau sekaligus lewat Excel.">
        <button className="btn" onClick={() => dl(true)}><Download size={15} /> Unduh data (Excel)</button>
        <button className="btn" onClick={() => setImporting(true)}><Upload size={15} /> Impor Excel</button>
        <button className="btn primary" onClick={() => setForm({ tab, row: null })}><Plus size={15} /> {ADD_LABEL[tab]}</button>
      </PageHead>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-body grid3">
          <div className="step"><b>1</b><div><div style={{ fontWeight: 500 }}>Satu per satu</div>
            <div className="muted" style={{ fontSize: 13 }}>Klik <b>Tambah</b> di kanan atas, atau klik baris di tabel untuk mengubah datanya.</div></div></div>
          <div className="step"><b>2</b><div><div style={{ fontWeight: 500 }}>Banyak sekaligus (Excel)</div>
            <div className="muted" style={{ fontSize: 13 }}>Unduh template, isi semua sheet, lalu impor. Untuk mengubah massal, unduh data saat ini → edit → impor.</div>
            <button className="btn sm" style={{ marginTop: 6 }} onClick={() => dl(false)}><FileSpreadsheet size={14} /> Template kosong</button></div></div>
          <div className="step"><b>3</b><div><div style={{ fontWeight: 500 }}>Pratinjau dulu</div>
            <div className="muted" style={{ fontSize: 13 }}>Impor Excel menampilkan baris baru / diubah dan kesalahan per baris sebelum disimpan.</div>
            <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setImporting(true)}><Upload size={14} /> Impor Excel</button></div></div>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={TABS} />
      {tab === 'items' && <ItemsTab onEdit={edit} />}
      {tab === 'suppliers' && <SuppliersTab onEdit={edit} />}
      {tab === 'prices' && <PricesTab onEdit={edit} />}
      {tab === 'expense' && <ExpenseTab onEdit={edit} />}
      {tab === 'accounts' && <AccountsTab onEdit={edit} />}
      {tab === 'methods' && <MethodsTab onEdit={edit} />}
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
      {form?.tab === 'items' && <ItemForm id={form.row?.id ?? null} onClose={() => setForm(null)} />}
      {form?.tab === 'suppliers' && <SupplierForm id={form.row?.id ?? null} onClose={() => setForm(null)} />}
      {form?.tab === 'prices' && <PriceForm row={form.row} onClose={() => setForm(null)} />}
      {form?.tab === 'expense' && <ExpenseForm row={form.row} onClose={() => setForm(null)} />}
      {form?.tab === 'accounts' && <AccountForm row={form.row} onClose={() => setForm(null)} />}
      {form?.tab === 'methods' && <MethodForm row={form.row} onClose={() => setForm(null)} />}
    </>
  );
}

// ---------- Tabel ----------
function useFilter<T>(rows: T[] | undefined, text: (r: T) => string) {
  const [q, setQ] = useState('');
  const list = (rows ?? []).filter((r) => !q || text(r).toLowerCase().includes(q.toLowerCase()));
  return { q, setQ, list };
}

// Tombol ubah & hapus di ujung baris (di HP tampil di pojok kanan atas kartu)
function RowActions({ url, label, onEdit }: { url: string; label: string; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const del = useAction(() => api.del(url), { success: 'Dihapus', invalidate: INVALIDATE, onDone: () => setOpen(false) });
  return (
    <span className="row-actions" onClick={(e) => e.stopPropagation()}>
      <button className="btn ghost icon sm" aria-label="Ubah" title="Ubah" onClick={onEdit}><Pencil size={14} /></button>
      <button className="btn ghost icon sm" aria-label="Hapus" title="Hapus" onClick={() => setOpen(true)}><Trash2 size={14} /></button>
      {open && <Confirm title="Hapus data?" text={<>Hapus <b>{label}</b>? Dokumen lama (PO, belanja) tetap menyimpan datanya.</>} busy={del.isPending} onConfirm={() => del.mutate(undefined)} onClose={() => setOpen(false)} />}
    </span>
  );
}

function Table({ head, children, empty, count, search }: { head: ReactNode; children: ReactNode; empty: boolean; count: number; search: ReactNode }) {
  return (
    <>
      <div className="toolbar">{search}<span className="muted" style={{ fontSize: 13 }}>{count} data · klik baris untuk mengubah</span></div>
      <div className="panel">
        {empty ? <Empty title="Belum ada data">Klik tombol <b>Tambah</b> di kanan atas, atau isi lewat template Excel.</Empty> : (
          <div className="table-wrap"><table className="t compact mcards"><thead>{head}</thead><tbody>{children}</tbody></table></div>
        )}
      </div>
    </>
  );
}

type TabProps = { onEdit: (row: any) => void };

function ItemsTab({ onEdit }: TabProps) {
  const { data, isLoading } = useApi<any[]>('/master/items');
  const f = useFilter(data, (r) => `${r.name} ${r.category ?? ''} ${r.sub_category ?? ''}`);
  if (isLoading) return <Loading />;
  return (
    <Table count={f.list.length} empty={!f.list.length} search={<SearchBox value={f.q} onChange={f.setQ} placeholder="Cari bahan / kategori…" />}
      head={<tr><th>Nama bahan</th><th>Satuan</th><th>Kategori</th><th>Sub kategori</th><th className="num">Supplier</th><th className="num">Harga termurah</th><th /></tr>}>
      {f.list.map((r) => (
        <tr key={r.id} className="click" onClick={() => onEdit(r)}>
          <td><b>{r.name}</b></td><td data-label="Satuan">{r.unit}</td><td data-label="Kategori">{r.category ?? <span className="muted">—</span>}</td><td data-label="Sub kategori">{r.sub_category ?? <span className="muted">—</span>}</td>
          <td className="num" data-label="Supplier">{r.supplier_count || <Badge tone="amber">belum ada</Badge>}</td>
          <td className="num" data-label="Harga termurah">{r.min_price != null ? rp(r.min_price) : '—'}</td>
          <td className="right x"><RowActions url={`/master/items/${r.id}`} label={r.name} onEdit={() => onEdit(r)} /></td>
        </tr>
      ))}
    </Table>
  );
}

function SuppliersTab({ onEdit }: TabProps) {
  const { data, isLoading } = useApi<any[]>('/master/suppliers');
  const f = useFilter(data, (r) => `${r.name} ${r.contact_name ?? ''} ${r.phone ?? ''}`);
  if (isLoading) return <Loading />;
  return (
    <Table count={f.list.length} empty={!f.list.length} search={<SearchBox value={f.q} onChange={f.setQ} placeholder="Cari supplier…" />}
      head={<tr><th>Supplier</th><th>Kontak</th><th>Alamat</th><th>Termin default</th><th className="num">Bahan</th><th /></tr>}>
      {f.list.map((r) => (
        <tr key={r.id} className="click" onClick={() => onEdit(r)}>
          <td><b>{r.name}</b></td><td data-label="Kontak">{r.contact_name ?? '—'}{r.phone && <span className="sub">{r.phone}</span>}</td>
          <td data-label="Alamat" style={{ whiteSpace: 'normal' }}>{r.address ?? '—'}</td>
          <td data-label="Termin default">{r.default_terms ? <span className={`kt ${r.default_terms === 'credit' ? 'K' : 'T'}`}>{r.default_terms === 'credit' ? 'K' : 'T'}</span> : <span className="muted">—</span>}</td>
          <td className="num" data-label="Bahan">{r.item_count || <Badge tone="amber">0</Badge>}</td>
          <td className="right x"><RowActions url={`/master/suppliers/${r.id}`} label={r.name} onEdit={() => onEdit(r)} /></td>
        </tr>
      ))}
    </Table>
  );
}

function PricesTab({ onEdit }: TabProps) {
  const { data, isLoading } = useApi<any[]>('/master/prices');
  const f = useFilter(data, (r) => `${r.supplier_name} ${r.item_name}`);
  if (isLoading) return <Loading />;
  return (
    <Table count={f.list.length} empty={!f.list.length} search={<SearchBox value={f.q} onChange={f.setQ} placeholder="Cari supplier / bahan…" />}
      head={<tr><th>Bahan · supplier</th><th className="num">Harga</th><th>Diperbarui</th><th /></tr>}>
      {f.list.map((r) => (
        <tr key={`${r.supplier_id}-${r.item_id}`} className="click" onClick={() => onEdit(r)}>
          <td><b>{r.item_name}</b> <span className="muted">/ {r.unit}</span><span className="sub">{r.supplier_name}</span></td>
          <td className="num" data-label="Harga">{r.price != null ? <>{rp(r.price)}{Number(r.price) > 0 && Number(r.price) < 1000 && <> <Badge tone="amber">cek</Badge></>}</> : <span className="muted">—</span>}</td>
          <td className="muted" data-label="Diperbarui">{date(r.updated_at)}</td>
          <td className="right x"><RowActions url={`/master/prices/${r.supplier_id}/${r.item_id}`} label={`${r.item_name} dari ${r.supplier_name}`} onEdit={() => onEdit(r)} /></td>
        </tr>
      ))}
    </Table>
  );
}

function ExpenseTab({ onEdit }: TabProps) {
  const { data, isLoading } = useApi<any[]>('/master/expense-items');
  const f = useFilter(data, (r) => `${r.name} ${r.category ?? ''}`);
  if (isLoading) return <Loading />;
  return (
    <Table count={f.list.length} empty={!f.list.length} search={<SearchBox value={f.q} onChange={f.setQ} placeholder="Cari bahan belanja…" />}
      head={<tr><th>Nama bahan</th><th>Satuan</th><th className="num">Harga default</th><th>Kategori</th><th>Sub kategori</th><th /></tr>}>
      {f.list.map((r) => (
        <tr key={r.id} className="click" onClick={() => onEdit(r)}>
          <td><b>{r.name}</b> {r.kind === 'daily' ? <Badge tone="green">Harian</Badge> : <Badge tone="blue">Karyawan</Badge>}</td>
          <td data-label="Satuan">{r.unit ?? '—'}</td><td className="num" data-label="Harga default">{r.default_price != null ? rp(r.default_price) : '—'}</td>
          <td data-label="Kategori">{r.category}</td><td data-label="Sub kategori">{r.sub_category}</td>
          <td className="right x"><RowActions url={`/master/expense-items/${r.id}`} label={r.name} onEdit={() => onEdit(r)} /></td>
        </tr>
      ))}
    </Table>
  );
}

function AccountsTab({ onEdit }: TabProps) {
  const { data, isLoading } = useApi<any[]>('/master/accounts');
  const f = useFilter(data, (r) => r.name);
  if (isLoading) return <Loading />;
  return (
    <Table count={f.list.length} empty={!f.list.length} search={<SearchBox value={f.q} onChange={f.setQ} placeholder="Cari rekening…" />}
      head={<tr><th>Kas / rekening</th><th /></tr>}>
      {f.list.map((r) => (
        <tr key={r.id} className="click" onClick={() => onEdit(r)}><td><b>{r.name}</b></td><td className="right x"><RowActions url={`/master/accounts/${r.id}`} label={r.name} onEdit={() => onEdit(r)} /></td></tr>
      ))}
    </Table>
  );
}

// Metode bayar di laporan pendapatan shift & kas / rekening tempat uangnya masuk (kolom Rekening baris PNDPTN)
function MethodsTab({ onEdit }: TabProps) {
  const { data, isLoading } = useApi<any[]>('/master/revenue-methods');
  const f = useFilter(data, (r) => r.name);
  if (isLoading) return <Loading />;
  return (
    <Table count={f.list.length} empty={!f.list.length} search={<SearchBox value={f.q} onChange={f.setQ} placeholder="Cari metode…" />}
      head={<tr><th>Metode bayar</th><th>Uang masuk ke</th><th className="num">Urutan</th><th /></tr>}>
      {f.list.map((r) => (
        <tr key={r.id} className="click" onClick={() => onEdit(r)}>
          <td><b>{r.name}</b></td><td data-label="Masuk ke">{r.pay_account_name ?? <span className="muted">—</span>}</td><td className="num" data-label="Urutan">{r.sort}</td>
          <td className="right x"><RowActions url={`/master/revenue-methods/${r.id}`} label={r.name} onEdit={() => onEdit(r)} /></td>
        </tr>
      ))}
    </Table>
  );
}

// ---------- Form input satu per satu ----------
// Isian teks dengan saran (kategori yang sudah dipakai, satuan umum); tetap boleh diketik bebas
function Suggest({ id, value, onChange, options, placeholder }: { id: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <>
      <Input list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <datalist id={id}>{[...new Set(options.filter(Boolean))].sort().map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );
}

function FormSheet({ title, sub, onClose, onSave, saving, children, wide }: { title: string; sub?: ReactNode; onClose: () => void; onSave: () => void; saving: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <Sheet title={title} sub={sub} onClose={onClose} wide={wide}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn primary" disabled={saving} onClick={onSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(); }}>{children}<button hidden /></form>
    </Sheet>
  );
}

type PriceRow = { key: number; other_id: string; price: string };
let seq = 1;

// Daftar pasangan supplier–bahan + harga di dalam form bahan / supplier
function PriceRows({ rows, setRows, options, label, unit }: { rows: PriceRow[]; setRows: (r: PriceRow[]) => void; options: { value: number; label: string }[]; label: string; unit?: (id: string) => string }) {
  const upd = (key: number, patch: Partial<PriceRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const used = new Set(rows.map((r) => r.other_id));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!rows.length && <div className="muted" style={{ fontSize: 13 }}>Belum ada. Klik <b>Tambah {label.toLowerCase()}</b>.</div>}
      {rows.length > 0 && (
        <table className="lines">
          <thead><tr><th style={{ width: '58%' }}>{label}</th><th>Harga{unit ? ' / satuan' : ''}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td data-label={label}><Select value={r.other_id} onChange={(e) => upd(r.key, { other_id: e.target.value })} placeholder={`— Pilih ${label.toLowerCase()} —`}
                  options={options.filter((o) => String(o.value) === r.other_id || !used.has(String(o.value)))} /></td>
                <td data-label="Harga" className="full"><Money value={r.price} onChange={(v) => upd(r.key, { price: v })} placeholder={unit && r.other_id ? `per ${unit(r.other_id)}` : 'boleh kosong'} />
                  <ThousandHint value={r.price} onFix={(v) => upd(r.key, { price: v })} /></td>
                <td className="x"><button type="button" className="btn ghost icon" aria-label="Hapus" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div><button type="button" className="btn sm" onClick={() => setRows([...rows, { key: seq++, other_id: '', price: '' }])}><Plus size={14} /> Tambah {label.toLowerCase()}</button></div>
    </div>
  );
}

function ItemForm({ id, onClose }: { id: number | null; onClose: () => void }) {
  const detail = useApi<any>(id ? `/master/items/${id}` : null);
  const all = useApi<any[]>('/master/items');
  const sups = useApi<any[]>('/master/suppliers');
  if (id && !detail.data) return <Sheet title="Bahan PO" onClose={onClose}><Loading /></Sheet>;
  return <ItemFormBody key={id ?? 'new'} id={id} cur={detail.data} items={all.data ?? []} suppliers={sups.data ?? []} onClose={onClose} />;
}
function ItemFormBody({ id, cur, items, suppliers, onClose }: { id: number | null; cur: any; items: any[]; suppliers: any[]; onClose: () => void }) {
  const [f, setF] = useState({ name: cur?.name ?? '', unit: cur?.unit ?? '', category: cur?.category ?? '', sub_category: cur?.sub_category ?? '' });
  const [rows, setRows] = useState<PriceRow[]>(() => (cur?.prices ?? []).map((p: any) => ({ key: seq++, other_id: String(p.supplier_id), price: p.price == null ? '' : String(p.price) })));
  const save = useAction(() => {
    const body = { ...f, prices: rows.filter((r) => r.other_id).map((r) => ({ supplier_id: Number(r.other_id), price: r.price })) };
    return id ? api.put(`/master/items/${id}`, body) : api.post('/master/items', body);
  }, { success: id ? 'Bahan disimpan' : 'Bahan ditambahkan', invalidate: INVALIDATE, onDone: onClose });
  return (
    <FormSheet title={id ? `Ubah bahan PO` : 'Tambah bahan PO'} sub="Barang yang dipesan lewat Purchase Order ke supplier" onClose={onClose} onSave={() => save.mutate(undefined)} saving={save.isPending} wide>
      <div className="grid2">
        <Field label="Nama bahan *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. Daging Sapi Has Dalam" autoFocus /></Field>
        <Field label="Satuan *" hint={cur?.used ? 'Sudah pernah dipesan — satuan tidak bisa diubah' : 'Pilih atau ketik sendiri'}>
          {cur?.used ? <Input value={f.unit} disabled /> : <Suggest id="dl-unit" value={f.unit} onChange={(v) => setF({ ...f, unit: v })} options={[...UNITS, ...items.map((i) => i.unit)]} placeholder="kg, liter, pcs…" />}
        </Field>
        <Field label="Kategori" hint="Kolom Kategori di jurnal umum"><Suggest id="dl-cat" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={items.map((i) => i.category)} placeholder="mis. 2.1 Biaya Bahan Baku Produksi" /></Field>
        <Field label="Sub kategori"><Suggest id="dl-sub" value={f.sub_category} onChange={(v) => setF({ ...f, sub_category: v })} options={items.map((i) => i.sub_category)} placeholder="mis. Daging, Sayur, Bumbu" /></Field>
      </div>
      <div className="section-title">Supplier & harga</div>
      <div className="muted" style={{ fontSize: 13, marginTop: -8 }}>Bahan hanya bisa dipesan ke supplier yang ada di daftar ini.</div>
      {!suppliers.length ? <div className="notice">Belum ada supplier. Tambahkan dulu di tab Supplier.</div>
        : <PriceRows rows={rows} setRows={setRows} label="Supplier" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} unit={() => f.unit || 'satuan'} />}
    </FormSheet>
  );
}

function SupplierForm({ id, onClose }: { id: number | null; onClose: () => void }) {
  const detail = useApi<any>(id ? `/master/suppliers/${id}` : null);
  const items = useApi<any[]>('/master/items');
  if (id && !detail.data) return <Sheet title="Supplier" onClose={onClose}><Loading /></Sheet>;
  return <SupplierFormBody key={id ?? 'new'} id={id} cur={detail.data} items={items.data ?? []} onClose={onClose} />;
}
function SupplierFormBody({ id, cur, items, onClose }: { id: number | null; cur: any; items: any[]; onClose: () => void }) {
  const [f, setF] = useState({ name: cur?.name ?? '', contact_name: cur?.contact_name ?? '', phone: cur?.phone ?? '', address: cur?.address ?? '', default_terms: cur?.default_terms ?? '' });
  const [rows, setRows] = useState<PriceRow[]>(() => (cur?.prices ?? []).map((p: any) => ({ key: seq++, other_id: String(p.item_id), price: p.price == null ? '' : String(p.price) })));
  const unitOf = useMemo(() => new Map(items.map((i) => [String(i.id), i.unit])), [items]);
  const save = useAction(() => {
    const body = { ...f, default_terms: f.default_terms || null, prices: rows.filter((r) => r.other_id).map((r) => ({ item_id: Number(r.other_id), price: r.price })) };
    return id ? api.put(`/master/suppliers/${id}`, body) : api.post('/master/suppliers', body);
  }, { success: id ? 'Supplier disimpan' : 'Supplier ditambahkan', invalidate: INVALIDATE, onDone: onClose });
  return (
    <FormSheet title={id ? 'Ubah supplier' : 'Tambah supplier'} onClose={onClose} onSave={() => save.mutate(undefined)} saving={save.isPending} wide>
      <div className="grid2">
        <Field label="Nama supplier *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. CV Sumber Daging" autoFocus /></Field>
        <Field label="Nama kontak"><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
        <Field label="Telepon / WA"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></Field>
        <Field label="Termin default" hint="Usulan K/T saat barang datang (Central Admin tetap bisa menetapkan per PO)">
          <Seg value={f.default_terms} onChange={(v) => setF({ ...f, default_terms: v })} options={[{ value: '', label: 'Tidak ada' }, { value: 'credit', label: 'K — Kredit' }, { value: 'cash', label: 'T — Tunai' }]} />
        </Field>
        <Field label="Alamat" span><textarea className="input textarea" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
      <div className="section-title">Bahan yang dijual & harga</div>
      {!items.length ? <div className="notice">Belum ada bahan PO. Tambahkan dulu di tab Bahan PO.</div>
        : <PriceRows rows={rows} setRows={setRows} label="Bahan" options={items.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))} unit={(oid) => unitOf.get(oid) ?? 'satuan'} />}
    </FormSheet>
  );
}

function PriceForm({ row, onClose }: { row: any; onClose: () => void }) {
  const items = useApi<any[]>('/master/items');
  const sups = useApi<any[]>('/master/suppliers');
  const [f, setF] = useState({ supplier_id: row ? String(row.supplier_id) : '', item_id: row ? String(row.item_id) : '', price: row?.price == null ? '' : String(row.price) });
  const unit = items.data?.find((i) => String(i.id) === f.item_id)?.unit;
  const save = useAction(() => api.put('/master/prices', f), { success: 'Harga disimpan', invalidate: INVALIDATE, onDone: onClose });
  return (
    <FormSheet title={row ? 'Ubah harga supplier' : 'Tambah harga supplier'} sub="Menautkan satu bahan ke satu supplier beserta harganya" onClose={onClose} onSave={() => save.mutate(undefined)} saving={save.isPending}>
      <Field label="Supplier *"><Select value={f.supplier_id} disabled={!!row} onChange={(e) => setF({ ...f, supplier_id: e.target.value })} placeholder="— Pilih supplier —" options={(sups.data ?? []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
      <Field label="Bahan *"><Select value={f.item_id} disabled={!!row} onChange={(e) => setF({ ...f, item_id: e.target.value })} placeholder="— Pilih bahan —" options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))} /></Field>
      <Field label={`Harga${unit ? ` per ${unit}` : ''}`} hint="Boleh kosong; harga PO terakhir otomatis menggantikannya"><Money value={f.price} onChange={(v) => setF({ ...f, price: v })} />
        <ThousandHint value={f.price} onFix={(v) => setF({ ...f, price: v })} /></Field>
    </FormSheet>
  );
}

function ExpenseForm({ row, onClose }: { row: any; onClose: () => void }) {
  const all = useApi<any[]>('/master/expense-items');
  const [f, setF] = useState({ kind: row?.kind ?? 'daily', name: row?.name ?? '', unit: row?.unit ?? '', default_price: row?.default_price == null ? '' : String(row.default_price),
    category: row?.category ?? '', sub_category: row?.sub_category ?? '' });
  const def = EXPENSE_DEFAULT[f.kind as 'daily'];
  const save = useAction(() => (row ? api.put(`/master/expense-items/${row.id}`, f) : api.post('/master/expense-items', f)),
    { success: row ? 'Bahan belanja disimpan' : 'Bahan belanja ditambahkan', invalidate: INVALIDATE, onDone: onClose });
  const others = all.data ?? [];
  return (
    <FormSheet title={row ? 'Ubah bahan belanja' : 'Tambah bahan belanja'} sub="Untuk Belanja Harian / Belanja Karyawan (tidak masuk persediaan)" onClose={onClose} onSave={() => save.mutate(undefined)} saving={save.isPending} wide>
      <Field label="Jenis *"><Seg value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'daily', label: 'Belanja Harian (HPP)' }, { value: 'employee', label: 'Belanja Karyawan (beban)' }]} /></Field>
      <div className="grid2">
        <Field label="Nama bahan *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. Cabai Rawit" autoFocus /></Field>
        <Field label="Satuan"><Suggest id="dl-eunit" value={f.unit} onChange={(v) => setF({ ...f, unit: v })} options={[...UNITS, ...others.map((i) => i.unit)]} placeholder="kg, ikat, paket…" /></Field>
        <Field label="Harga default" hint="Dipakai mengisi otomatis total harga saat belanja"><Money value={f.default_price} onChange={(v) => setF({ ...f, default_price: v })} />
          <ThousandHint value={f.default_price} onFix={(v) => setF({ ...f, default_price: v })} /></Field>
        <span />
        <Field label="Kategori" hint={`Kosong = ${def.category}`}><Suggest id="dl-ecat" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={others.map((i) => i.category)} placeholder={def.category} /></Field>
        <Field label="Sub kategori" hint={`Kosong = ${def.sub_category}`}><Suggest id="dl-esub" value={f.sub_category} onChange={(v) => setF({ ...f, sub_category: v })} options={others.map((i) => i.sub_category)} placeholder={def.sub_category} /></Field>
      </div>
    </FormSheet>
  );
}

function AccountForm({ row, onClose }: { row: any; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? '');
  const save = useAction(() => (row ? api.put(`/master/accounts/${row.id}`, { name }) : api.post('/master/accounts', { name })),
    { success: row ? 'Rekening disimpan' : 'Rekening ditambahkan', invalidate: INVALIDATE, onDone: onClose });
  return (
    <FormSheet title={row ? 'Ubah rekening' : 'Tambah rekening'} sub="Kas / rekening untuk pembayaran (kolom Rekening di jurnal umum)" onClose={onClose} onSave={() => save.mutate(undefined)} saving={save.isPending}>
      <Field label="Nama kas / rekening *"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. BCA 1234567890 a.n. Resto" autoFocus /></Field>
    </FormSheet>
  );
}

function MethodForm({ row, onClose }: { row: any; onClose: () => void }) {
  const { data: accounts } = useApi<any[]>('/master/accounts');
  const [f, setF] = useState({ name: row?.name ?? '', pay_account_id: row?.pay_account_id ? String(row.pay_account_id) : '', sort: row?.sort != null ? String(row.sort) : '' });
  const save = useAction(() => (row ? api.put(`/master/revenue-methods/${row.id}`, f) : api.post('/master/revenue-methods', f)),
    { success: row ? 'Metode disimpan' : 'Metode ditambahkan', invalidate: INVALIDATE, onDone: onClose });
  return (
    <FormSheet title={row ? 'Ubah metode pendapatan' : 'Tambah metode pendapatan'} sub="Diisi Manager di laporan pendapatan setiap shift" onClose={onClose} onSave={() => save.mutate(undefined)} saving={save.isPending}>
      <Field label="Nama metode *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. QRIS, GoFood, ShopeeFood" autoFocus /></Field>
      <Field label="Uang masuk ke (opsional)" hint="Kolom Rekening di jurnal umum">
        <Select value={f.pay_account_id} onChange={(e) => setF({ ...f, pay_account_id: e.target.value })} placeholder="— Kas / rekening —" options={(accounts ?? []).map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      <Field label="Urutan di form (opsional)"><Input inputMode="numeric" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value.replace(/\D/g, '') })} placeholder="1, 2, 3, …" /></Field>
    </FormSheet>
  );
}

// ---------- Impor Excel ----------
const fileToBase64 = (f: File) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => fail(new Error('File tidak bisa dibaca'));
  r.readAsDataURL(f);
});

function ImportSheet({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const toast = useToast();
  const check = useAction(async (f: { name: string; data: string }) => api.post('/master/import', { file: f.data, filename: f.name, dry: true }), { onDone: setPreview });
  const save = useAction(() => api.post('/master/import', { file: file!.data, filename: file!.name }), { success: 'Master data tersimpan', invalidate: INVALIDATE, onDone: onClose });
  const pick = async (f?: File | null) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { toast('Pilih file Excel .xlsx', true); return; }
    const x = { name: f.name, data: await fileToBase64(f) };
    setFile(x);
    setPreview(null);
    check.mutate(x);
  };
  const changes = preview ? Object.values(preview.summary as Record<string, any>).reduce((s: number, n: any) => s + n.create + n.update, 0) : 0;
  return (
    <Sheet title="Impor master data dari Excel" onClose={onClose} wide
      footer={<>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" disabled={!preview || preview.errors.length > 0 || !changes || save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? 'Menyimpan…' : 'Simpan ke master data'}
        </button>
      </>}>
      <div className="stack">
        <button type="button" className="photo-drop" style={{ height: 110 }} onClick={() => input.current?.click()}>
          <FileSpreadsheet size={22} />
          <span>{file ? file.name : 'Pilih file Excel (.xlsx) hasil isi template'}</span>
          {file && <span className="muted" style={{ fontSize: 12 }}>klik untuk ganti file</span>}
        </button>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        {check.isPending && <Loading />}
        {preview && (
          <>
            <div className="section-title">Pratinjau</div>
            <div className="panel">
              <div className="table-wrap">
                <table className="t compact">
                  <thead><tr><th>Sheet</th><th className="num">Baru</th><th className="num">Diubah</th><th className="num">Sama</th></tr></thead>
                  <tbody>
                    {Object.entries(preview.summary as Record<string, any>).map(([sheet, n]) => (
                      <tr key={sheet}><td>{sheet}</td><td className="num">{n.create ? <b className="up">+{n.create}</b> : 0}</td><td className="num">{n.update ? <b>{n.update}</b> : 0}</td><td className="num muted">{n.same}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {preview.errors.length > 0 ? (
              <>
                <div className="notice" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
                  Ada {preview.errors.length} kesalahan. Perbaiki di Excel lalu pilih file lagi — tidak ada yang disimpan sampai semua baris benar.
                </div>
                <div className="panel import-errors">
                  <table className="t compact">
                    <thead><tr><th>Sheet</th><th className="num">Baris</th><th>Masalah</th></tr></thead>
                    <tbody>{preview.errors.map((e: any, i: number) => <tr key={i}><td>{e.sheet}</td><td className="num">{e.row}</td><td style={{ whiteSpace: 'normal' }}>{e.message}</td></tr>)}</tbody>
                  </table>
                </div>
              </>
            ) : changes ? (
              <div className="notice ok">Tidak ada kesalahan. {fq(changes)} baris akan ditambahkan / diperbarui. Klik <b>Simpan ke master data</b>.</div>
            ) : (
              <div className="notice info">Tidak ada perubahan — semua data di file sama dengan yang tersimpan.</div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
