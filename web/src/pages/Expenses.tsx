import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { api, qs } from '../api';
import { useSession } from '../session';
import { useApi, useAction } from '../ui/hooks';
import { Badge, Confirm, Empty, Field, Input, Loading, Money, PageHead, Pager, SearchBox, Select, Sheet, StageFilter, Suffix } from '../ui/kit';
import { ExtraPhotos, PhotoInput, PhotoStrip, type Photo } from '../ui/photo';
import { date, dateTime, qty as fq, rp, todayStr } from '../format';

type Kind = 'daily' | 'employee';
const LABEL: Record<Kind, { title: string; sub: string }> = {
  daily: { title: 'Belanja Harian', sub: 'Bahan harian yang dibeli tunai di pasar / toko (HPP, tidak masuk persediaan). Wajib foto nota.' },
  employee: { title: 'Belanja Karyawan', sub: 'Belanja untuk makan karyawan (beban). Wajib foto nota.' },
};

export default function Expenses({ kind }: { kind: Kind }) {
  const [f, setF] = useState({ status: '', q: '', from: '', to: '', page: 1 });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  const { data, isLoading } = useApi<any>(`/expenses${qs({ ...f, kind })}`, { keepPrevious: true });
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHead title={LABEL[kind].title} sub={LABEL[kind].sub}>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> Catat belanja</button>
      </PageHead>
      <StageFilter value={f.status} onChange={(v) => set('status', v)} options={[{ value: '', label: 'Tercatat' }, { value: 'void', label: 'Dibatalkan', tone: 'red' }, { value: 'all', label: 'Semua' }]} />
      <div className="toolbar">
        <SearchBox value={f.q} onChange={(v) => set('q', v)} placeholder="Cari nomor / toko / bahan…" />
        <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} style={{ width: 150 }} />
        <span className="muted">s/d</span>
        <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} style={{ width: 150 }} />
        <span className="spacer" />
        {data && <span className="muted">Total: <b className="tnum" style={{ color: 'var(--ink)' }}>{rp(data.sum)}</b></span>}
      </div>
      {isLoading ? <Loading /> : !data?.data.length ? (
        <div className="panel"><Empty title="Belum ada belanja">Klik <b>Catat belanja</b> untuk menambahkan.</Empty></div>
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Nomor</th><th>Tanggal</th><th>Toko</th><th>Bahan</th><th>Dibayar dari</th><th>Dicatat</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.data.map((x: any) => (
                  <tr key={x.id} className="click" onClick={() => setOpen(x.id)}>
                    <td className="mono">{x.number}{x.voided_at && <> <Badge tone="red">Batal</Badge></>}</td>
                    <td>{date(x.expense_date)}</td>
                    <td>{x.supplier_name ?? <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{x.item_names}</td>
                    <td>{x.pay_account_name}</td>
                    <td>{x.created_by_name}<span className="sub">{dateTime(x.created_at)}</span></td>
                    <td className="num">{x.voided_at ? <s className="muted">{rp(x.total)}</s> : rp(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} size={data.size} total={data.total} onPage={(p) => set('page', p)} />
        </div>
      )}
      {creating && <CreateExpense kind={kind} onClose={() => setCreating(false)} />}
      {open && <ExpenseDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

type Line = { key: number; item_id: string; qty: string; amount: string };
let seq = 1;
const newLine = (): Line => ({ key: seq++, item_id: '', qty: '', amount: '' });

function CreateExpense({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const { data: opt } = useApi<any>('/master/options');
  const items = useMemo(() => (opt?.expense_items ?? []).filter((i: any) => i.kind === kind), [opt, kind]);
  const byId = useMemo(() => new Map<number, any>(items.map((i: any) => [i.id, i])), [items]);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [f, setF] = useState({ expense_date: todayStr(), supplier_name: '', pay_account_id: '', notes: '' });
  const [nota, setNota] = useState<Photo | null>(null);
  const [extra, setExtra] = useState<Photo[]>([]);
  const upd = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // harga = total per baris; diisi otomatis dari harga default × jumlah
  const setQty = (l: Line, v: string) => {
    const it = byId.get(Number(l.item_id));
    upd(l.key, { qty: v, amount: it?.default_price != null && v ? String(Math.round(Number(v) * Number(it.default_price))) : l.amount });
  };
  const filled = lines.filter((l) => l.item_id);
  const total = filled.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const save = useAction(() => api.post('/expenses', { kind, ...f, receipt_photo_id: nota?.id, extra_photo_ids: extra.map((x) => x.id),
    lines: filled.map((l) => ({ item_id: Number(l.item_id), qty: l.qty, amount: l.amount })) }), {
    success: (r: any) => `${r.number} tercatat`, invalidate: ['/expenses', '/summary', '/journal', '/logs'], onDone: onClose,
  });
  const missing = !filled.length ? 'Tambahkan bahan' : !nota ? 'Lampirkan foto nota' : !f.pay_account_id ? 'Pilih kas / rekening' : total <= 0 ? 'Isi harga' : '';
  return (
    <Sheet title={`Catat ${LABEL[kind].title.toLowerCase()}`} onClose={onClose} wide
      footer={<><span className="muted" style={{ fontSize: 13 }}>{missing}</span><span className="spacer" /><button className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" disabled={!!missing || save.isPending} onClick={() => save.mutate(undefined)}>Simpan · {rp(total)}</button></>}>
      {!opt ? <Loading /> : !items.length ? (
        <Empty title="Belum ada bahan">Central Admin perlu mengisi sheet <b>Bahan Belanja</b> (Jenis = {kind === 'daily' ? 'Harian' : 'Karyawan'}) di template Excel.</Empty>
      ) : (
        <div className="stack">
          <div className="grid3">
            <Field label="Tanggal belanja"><Input type="date" value={f.expense_date} max={todayStr()} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
            <Field label="Nama toko / pasar (opsional)"><Input value={f.supplier_name} onChange={(e) => setF({ ...f, supplier_name: e.target.value })} placeholder="mis. Pasar Senen" /></Field>
            <Field label="Dibayar dari"><Select value={f.pay_account_id} onChange={(e) => setF({ ...f, pay_account_id: e.target.value })} placeholder="— Kas / rekening —" options={(opt.accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }))} /></Field>
          </div>
          <table className="lines">
            <thead><tr><th style={{ width: '45%' }}>Bahan</th><th>Jumlah</th><th>Total harga</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => {
                const it = byId.get(Number(l.item_id));
                return (
                  <tr key={l.key}>
                    <td data-label="Bahan"><Select value={l.item_id} onChange={(e) => upd(l.key, { item_id: e.target.value })} placeholder="— Pilih bahan —"
                      options={items.map((i: any) => ({ value: i.id, label: `${i.name}${i.unit ? ` (${i.unit})` : ''}${i.default_price != null ? ` · ${rp(i.default_price)}` : ''}` }))} /></td>
                    <td data-label="Jumlah"><Suffix value={l.qty} onChange={(v) => setQty(l, v)} suffix={it?.unit ?? '—'} /></td>
                    <td data-label="Total harga"><Money value={l.amount} onChange={(v) => upd(l.key, { amount: v })} /></td>
                    <td className="x"><button className="btn ghost icon" aria-label="Hapus baris" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}><Trash2 size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div><button className="btn sm" onClick={() => setLines((ls) => [...ls, newLine()])}><Plus size={14} /> Tambah bahan</button></div>
          <div className="photo-grid">
            <PhotoInput label="Foto nota / struk (wajib)" kind="expense" value={nota} onChange={setNota} />
            <ExtraPhotos kind="expense" value={extra} onChange={setExtra} />
          </div>
          <Field label="Catatan (opsional)"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      )}
    </Sheet>
  );
}

function ExpenseDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { isCentral } = useSession();
  const { data: x } = useApi<any>(`/expenses/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [note, setNote] = useState('');
  const doVoid = useAction(() => api.post(`/expenses/${id}/void`, { note }), { success: 'Belanja dibatalkan', invalidate: ['/expenses', '/summary', '/journal', '/logs'], onDone: () => setVoiding(false) });
  if (!x) return <Sheet title="Belanja" onClose={onClose}><Loading /></Sheet>;
  return (
    <Sheet title={x.number} sub={<>{date(x.expense_date)} · dicatat {x.created_by_name} {dateTime(x.created_at)}</>} onClose={onClose} wide
      footer={isCentral && !x.voided_at ? <><span className="spacer" /><button className="btn danger" onClick={() => setVoiding(true)}><X size={15} /> Batalkan belanja</button></> : undefined}>
      <div className="stack">
        {x.voided_at && <div className="notice" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>Dibatalkan {x.voided_by_name} {dateTime(x.voided_at)}: {x.void_note}</div>}
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Jenis</dt><dd>{x.kind === 'daily' ? 'Belanja harian (PTH)' : 'Belanja karyawan (PTH)'}</dd>
          <dt>Toko</dt><dd>{x.supplier_name ?? '—'}</dd>
          <dt>Dibayar dari</dt><dd>{x.pay_account_name}</dd>
          {x.notes && <><dt>Catatan</dt><dd>{x.notes}</dd></>}
        </dl>
        <div className="panel">
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Bahan</th><th className="num">Jumlah</th><th className="num">Harga / satuan</th><th className="num">Total</th></tr></thead>
              <tbody>{x.lines.map((l: any) => <tr key={l.id}><td><b>{l.name}</b><span className="sub">{l.category} · {l.sub_category}</span></td><td className="num">{fq(l.qty)} {l.unit}</td><td className="num">{rp(Number(l.amount) / Number(l.qty))}</td><td className="num">{rp(l.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td className="num">{rp(x.total)}</td></tr></tfoot>
            </table>
          </div>
        </div>
        <div className="section-title">Foto</div>
        <PhotoStrip photos={[{ id: x.receipt_photo_id, label: 'Nota' }, ...(x.extra_photo_ids ?? []).map((p: number, i: number) => ({ id: p, label: `Foto ${i + 1}` }))]} />
        {x.logs.length > 0 && <><div className="section-title">Riwayat</div><div className="timeline">{x.logs.map((l: any) => <div key={l.id}><span className="muted tnum">{dateTime(l.created_at)}</span><span><b>{l.user_name}</b> — {l.detail}</span></div>)}</div></>}
      </div>
      {voiding && <Confirm title="Batalkan belanja?" confirmText="Batalkan belanja" busy={doVoid.isPending || !note.trim()} onConfirm={() => doVoid.mutate(undefined)} onClose={() => setVoiding(false)}
        text={<span className="stack" style={{ gap: 8 }}>Belanja ini tidak lagi dihitung di jurnal umum.<textarea className="input textarea" placeholder="Alasan (wajib)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></span>} />}
    </Sheet>
  );
}
