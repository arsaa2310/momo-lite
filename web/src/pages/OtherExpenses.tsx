import { useState } from 'react';
import { Check, Plus, Trash2, Undo2, X } from 'lucide-react';
import { api, qs } from '../api';
import { useSession } from '../session';
import { useApi, useAction } from '../ui/hooks';
import { Badge, Confirm, Empty, Field, Input, Loading, Money, PageHead, Pager, SearchBox, Select, Sheet, StageFilter } from '../ui/kit';
import { ExtraPhotos, PhotoInput, PhotoStrip, type Photo } from '../ui/photo';
import { date, dateTime, rp, todayStr } from '../format';

const STATUS: Record<string, { label: string; tone: 'amber' | 'green' | 'red' }> = {
  approval: { label: 'Menunggu persetujuan', tone: 'amber' }, approved: { label: 'Disetujui', tone: 'green' },
  rejected: { label: 'Ditolak', tone: 'red' }, void: { label: 'Dibatalkan', tone: 'red' },
};
const INVALIDATE = ['/other-expenses', '/summary', '/journal', '/logs', '/owner'];

// Pengeluaran lain (listrik, gas, servis, sewa, …): Manager mengajukan → Central Admin / Owner menyetujui. Masuk jurnal setelah disetujui.
export default function OtherExpenses() {
  const { isAdmin } = useSession();
  const [f, setF] = useState({ status: isAdmin ? 'approval' : '', q: '', from: '', to: '', page: 1 });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  const { data, isLoading } = useApi<any>(`/other-expenses${qs(f)}`, { keepPrevious: true });
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const c = data?.counts ?? {};
  return (
    <>
      <PageHead title="Pengeluaran Lain" sub={isAdmin ? 'Listrik, gas, air, servis, sewa, dan biaya lain di luar PO & belanja. Pengajuan Manager perlu persetujuan Anda.'
        : 'Listrik, gas, air, servis, sewa, dan biaya lain di luar PO & belanja. Masuk jurnal setelah disetujui Central Admin / Owner.'}>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> Catat pengeluaran</button>
      </PageHead>
      <StageFilter value={f.status} onChange={(v) => set('status', v)} options={[
        { value: '', label: 'Semua' },
        { value: 'approval', label: 'Menunggu persetujuan', tone: 'amber', count: c.approval },
        { value: 'approved', label: 'Disetujui', tone: 'green' },
        { value: 'rejected', label: 'Ditolak', tone: 'red' },
        { value: 'void', label: 'Dibatalkan', tone: 'red' },
      ]} />
      <div className="toolbar">
        <SearchBox value={f.q} onChange={(v) => set('q', v)} placeholder="Cari nomor / penerima / kategori…" />
        <div className="date-range">
          <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
          <span className="muted">s/d</span>
          <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        <span className="spacer" />
        {data && <span className="muted">Total disetujui: <b className="tnum" style={{ color: 'var(--ink)' }}>{rp(data.sum)}</b></span>}
      </div>
      {isLoading ? <Loading /> : !data?.data.length ? (
        <div className="panel"><Empty title="Belum ada pengeluaran">{f.status ? 'Tidak ada data dengan status ini.' : <>Klik <b>Catat pengeluaran</b> untuk menambahkan.</>}</Empty></div>
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table className="t mcards">
              <thead><tr><th>Nomor</th><th>Tanggal</th><th>Dibayar ke</th><th>Keterangan</th><th>Kategori</th><th>Status</th><th>Dicatat</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.data.map((x: any) => (
                  <tr key={x.id} className="click" onClick={() => setOpen(x.id)}>
                    <td className="mono">{x.number}</td>
                    <td data-label="Tanggal">{date(x.expense_date)}</td>
                    <td data-label="Dibayar ke">{x.payee}</td>
                    <td data-label="Keterangan" className="full" style={{ whiteSpace: 'normal', maxWidth: 280 }}>{x.item_names}</td>
                    <td data-label="Kategori">{x.categories}</td>
                    <td data-label="Status"><Badge tone={STATUS[x.status]?.tone}>{STATUS[x.status]?.label}</Badge></td>
                    <td data-label="Dicatat">{x.created_by_name}<span className="sub">{dateTime(x.created_at)}</span></td>
                    <td className="num full" data-label="Total">{['rejected', 'void'].includes(x.status) ? <s className="muted">{rp(x.total)}</s> : rp(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} size={data.size} total={data.total} onPage={(p) => set('page', p)} />
        </div>
      )}
      {creating && <CreateOther onClose={() => setCreating(false)} />}
      {open && <OtherDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

type Line = { key: number; description: string; category: string; amount: string };
let seq = 1;
const newLine = (): Line => ({ key: seq++, description: '', category: '', amount: '' });

function CreateOther({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useSession();
  const { data: opt } = useApi<any>('/master/options');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [f, setF] = useState({ expense_date: todayStr(), payee: '', pay_account_id: '', notes: '' });
  const [nota, setNota] = useState<Photo | null>(null);
  const [extra, setExtra] = useState<Photo[]>([]);
  const upd = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const filled = lines.filter((l) => l.description.trim() || Number(l.amount));
  const total = filled.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const save = useAction(() => api.post('/other-expenses', { ...f, receipt_photo_id: nota?.id, extra_photo_ids: extra.map((x) => x.id),
    lines: filled.map((l) => ({ description: l.description, category: l.category, amount: l.amount })) }), {
    success: (r: any) => `${r.number} ${r.status === 'approval' ? 'diajukan — menunggu persetujuan' : 'tercatat'}`, invalidate: INVALIDATE, onDone: onClose,
  });
  const missing = !f.payee.trim() ? 'Isi dibayar ke siapa' : !filled.length ? 'Tambahkan baris' : filled.some((l) => !l.description.trim()) ? 'Isi keterangan'
    : filled.some((l) => !l.category.trim()) ? 'Pilih kategori' : !nota ? 'Lampirkan foto nota' : !f.pay_account_id ? 'Pilih kas / rekening' : total <= 0 ? 'Isi nominal' : '';
  return (
    <Sheet title="Catat pengeluaran lain" sub={isAdmin ? 'Langsung disetujui & masuk jurnal umum.' : 'Diajukan ke Central Admin / Owner untuk disetujui.'} onClose={onClose} wide
      footer={<><span className="muted" style={{ fontSize: 13 }}>{missing}</span><span className="spacer" /><button className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" disabled={!!missing || save.isPending} onClick={() => save.mutate(undefined)}>{isAdmin ? 'Simpan' : 'Ajukan'} · {rp(total)}</button></>}>
      {!opt ? <Loading /> : (
        <div className="stack">
          <div className="grid3">
            <Field label="Tanggal"><Input type="date" value={f.expense_date} max={todayStr()} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
            <Field label="Dibayar ke"><Input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} placeholder="mis. PLN, Toko Las Jaya, Pak Udin" /></Field>
            <Field label="Dibayar dari"><Select value={f.pay_account_id} onChange={(e) => setF({ ...f, pay_account_id: e.target.value })} placeholder="— Kas / rekening —" options={(opt.accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }))} /></Field>
          </div>
          <table className="lines">
            <thead><tr><th style={{ width: '40%' }}>Keterangan</th><th style={{ width: '32%' }}>Kategori</th><th>Nominal</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td data-label="Keterangan"><Input value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} placeholder="mis. Token listrik Oktober" /></td>
                  <td data-label="Kategori">
                    <Input list="other-cats" value={l.category} onChange={(e) => upd(l.key, { category: e.target.value })} placeholder="— Pilih / ketik —" />
                  </td>
                  <td data-label="Nominal"><Money value={l.amount} onChange={(v) => upd(l.key, { amount: v })} /></td>
                  <td className="x"><button className="btn ghost icon" aria-label="Hapus baris" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="other-cats">{(opt.other_categories ?? []).map((c: string) => <option key={c} value={c} />)}</datalist>
          <div><button className="btn sm" onClick={() => setLines((ls) => [...ls, newLine()])}><Plus size={14} /> Tambah baris</button></div>
          <div className="photo-grid">
            <PhotoInput label="Foto nota / bukti bayar (wajib)" kind="expense" value={nota} onChange={setNota} />
            <ExtraPhotos kind="expense" value={extra} onChange={setExtra} />
          </div>
          <Field label="Catatan (opsional)"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      )}
    </Sheet>
  );
}

function OtherDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { isAdmin, user } = useSession();
  const { data: x } = useApi<any>(`/other-expenses/${id}`);
  const [dialog, setDialog] = useState<null | 'reject' | 'void' | 'withdraw'>(null);
  const [note, setNote] = useState('');
  const act = useAction(({ url, body, del }: { url: string; body?: any; del?: boolean }) => (del ? api.del(url) : api.post(url, body)),
    { success: 'Tersimpan', invalidate: INVALIDATE, onDone: () => { setDialog(null); setNote(''); } });
  if (!x) return <Sheet title="Pengeluaran lain" onClose={onClose}><Loading /></Sheet>;
  const st = STATUS[x.status];
  return (
    <Sheet title={x.number} sub={<>{date(x.expense_date)} · dicatat {x.created_by_name} {dateTime(x.created_at)}</>} onClose={onClose} wide
      footer={<>
        <span className="spacer" />
        {x.status === 'approval' && x.created_by === user.id && !isAdmin && <button className="btn" onClick={() => setDialog('withdraw')}><Undo2 size={15} /> Tarik pengajuan</button>}
        {isAdmin && x.status === 'approval' && <button className="btn danger" onClick={() => setDialog('reject')}><X size={15} /> Tolak</button>}
        {isAdmin && x.status === 'approval' && <button className="btn primary" disabled={act.isPending} onClick={() => act.mutate({ url: `/other-expenses/${id}/approve`, body: {} })}><Check size={15} /> Setujui</button>}
        {isAdmin && x.status === 'approved' && <button className="btn danger" onClick={() => setDialog('void')}><X size={15} /> Batalkan</button>}
      </>}>
      <div className="stack">
        <div className="row wrap"><Badge tone={st?.tone}>{st?.label}</Badge></div>
        {x.decided_at && x.status !== 'approval' && x.decided_by !== x.created_by && (
          <div className={`notice ${x.status === 'approved' || x.status === 'void' ? 'ok' : ''}`} style={x.status === 'rejected' ? { background: 'var(--red-soft)', color: 'var(--red)' } : undefined}>
            {x.status === 'rejected' ? 'Ditolak' : 'Disetujui'} {x.decided_by_name} {dateTime(x.decided_at)}{x.decide_note ? `: ${x.decide_note}` : ''}
          </div>
        )}
        {x.voided_at && <div className="notice" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>Dibatalkan {x.voided_by_name} {dateTime(x.voided_at)}: {x.void_note}</div>}
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Dibayar ke</dt><dd>{x.payee}</dd>
          <dt>Dibayar dari</dt><dd>{x.pay_account_name}</dd>
          {x.notes && <><dt>Catatan</dt><dd>{x.notes}</dd></>}
        </dl>
        <div className="panel">
          <div className="table-wrap">
            <table className="t compact mcards">
              <thead><tr><th>Keterangan</th><th>Kategori</th><th className="num">Nominal</th></tr></thead>
              <tbody>{x.lines.map((l: any) => <tr key={l.id}><td><b>{l.description}</b></td><td data-label="Kategori">{l.category}{l.sub_category && <span className="sub">{l.sub_category}</span>}</td><td className="num full" data-label="Nominal">{rp(l.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={2}>Total</td><td className="num">{rp(x.total)}</td></tr></tfoot>
            </table>
          </div>
        </div>
        <div className="section-title">Foto</div>
        <PhotoStrip photos={[{ id: x.receipt_photo_id, label: 'Nota' }, ...(x.extra_photo_ids ?? []).map((p: number, i: number) => ({ id: p, label: `Foto ${i + 1}` }))]} />
        {x.logs.length > 0 && <><div className="section-title">Riwayat</div><div className="timeline">{x.logs.map((l: any) => <div key={l.id}><span className="muted tnum">{dateTime(l.created_at)}</span><span><b>{l.user_name}</b> — {l.detail}</span></div>)}</div></>}
      </div>
      {(dialog === 'reject' || dialog === 'void') && (
        <Confirm title={dialog === 'reject' ? `Tolak ${x.number}?` : `Batalkan ${x.number}?`} confirmText={dialog === 'reject' ? 'Tolak' : 'Batalkan'}
          busy={act.isPending || !note.trim()} onConfirm={() => act.mutate({ url: `/other-expenses/${id}/${dialog}`, body: { note } })} onClose={() => setDialog(null)}
          text={<span className="stack" style={{ gap: 8 }}>{dialog === 'reject' ? 'Pengeluaran tidak masuk jurnal. Pembuat melihat alasannya.' : 'Pengeluaran keluar dari jurnal umum.'}
            <textarea className="input textarea" placeholder="Alasan (wajib)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></span>} />
      )}
      {dialog === 'withdraw' && <Confirm title="Tarik pengajuan?" text="Pengajuan ini dibatalkan sebelum diproses." confirmText="Tarik" busy={act.isPending}
        onConfirm={() => act.mutate({ url: `/other-expenses/${id}`, del: true })} onClose={() => setDialog(null)} />}
    </Sheet>
  );
}
