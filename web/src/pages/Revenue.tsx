import { useState } from 'react';
import { Lock, LockOpen, Pencil, Plus, X } from 'lucide-react';
import { api, qs } from '../api';
import { useSession } from '../session';
import { useApi, useAction } from '../ui/hooks';
import { Badge, Confirm, Empty, Field, Input, Loading, Money, PageHead, Seg, Sheet, StageFilter, ThousandHint } from '../ui/kit';
import { ExtraPhotos, PhotoStrip, photoUrl, type Photo } from '../ui/photo';
import { date, dateTime, rp, todayStr } from '../format';

const STATUS: Record<string, { label: string; tone: 'amber' | 'green' | 'red' }> = {
  submitted: { label: 'Dilaporkan', tone: 'amber' }, verified: { label: 'Dicek & dikunci', tone: 'green' }, void: { label: 'Dibatalkan', tone: 'red' },
};
const INVALIDATE = ['/revenue', '/summary', '/journal', '/logs', '/owner'];
const firstOfMonth = () => `${todayStr().slice(0, 7)}-01`;

// Pendapatan per shift: Manager mengisi uang masuk setiap akhir shift per metode bayar. Central Admin / Owner mengecek & mengunci.
export default function Revenue() {
  const { isAdmin } = useSession();
  const [f, setF] = useState({ from: firstOfMonth(), to: todayStr(), status: '' });
  const { data, isLoading } = useApi<any>(`/revenue${qs(f)}`, { keepPrevious: true });
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState<null | { report?: any; date?: string; shift?: string }>(null);
  return (
    <>
      <PageHead title="Pendapatan Shift" sub={`Uang masuk setiap akhir shift, dirinci per metode bayar. Shift: ${(data?.shifts ?? []).join(', ') || '—'} (diatur Owner).`}>
        <button className="btn primary" onClick={() => setForm({})}><Plus size={15} /> Laporkan pendapatan</button>
      </PageHead>
      <StageFilter value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[
        { value: '', label: 'Semua' }, { value: 'submitted', label: isAdmin ? 'Belum dicek' : 'Dilaporkan', tone: 'amber' },
        { value: 'verified', label: 'Dikunci', tone: 'green' }, { value: 'void', label: 'Dibatalkan', tone: 'red' },
      ]} />
      <div className="toolbar">
        <div className="date-range">
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <span className="muted">s/d</span>
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
      </div>
      {data && (
        <div className="stats" style={{ marginBottom: 14 }}>
          <div className="stat"><label>Total pendapatan</label><div className="v" style={{ color: 'var(--green)' }}>{rp(data.total)}</div><div className="d">{date(data.from)} – {date(data.to)}</div></div>
          {data.by_method.slice(0, 4).map((m: any) => <div key={m.method_name} className="stat"><label>{m.method_name}</label><div className="v">{rp(m.amount)}</div></div>)}
        </div>
      )}
      {data?.missing?.length > 0 && !f.status && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head"><h3>Belum dilaporkan</h3><span className="spacer" /><span className="muted" style={{ fontSize: 13 }}>{data.missing.length} shift</span></div>
          <div className="panel-body chips">
            {data.missing.slice(0, 20).map((m: any) => (
              <button key={`${m.date}-${m.shift}`} className="btn sm" onClick={() => setForm({ date: m.date, shift: m.shift })}><Plus size={13} /> {date(m.date)} · {m.shift}</button>
            ))}
          </div>
        </div>
      )}
      {isLoading ? <Loading /> : !data?.data.length ? (
        <div className="panel"><Empty title="Belum ada laporan pendapatan">Klik <b>Laporkan pendapatan</b> di akhir shift.</Empty></div>
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table className="t mcards">
              <thead><tr><th>Nomor</th><th>Tanggal</th><th>Shift</th><th>Rincian</th><th className="num">Transaksi</th><th>Status</th><th>Dilaporkan</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.data.map((x: any) => (
                  <tr key={x.id} className="click" onClick={() => setOpen(x.id)}>
                    <td className="mono">{x.number}</td>
                    <td data-label="Tanggal">{date(x.report_date)}</td>
                    <td data-label="Shift">{x.shift}</td>
                    <td data-label="Rincian" className="full" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{x.lines.map((l: any) => `${l.method_name} ${rp(l.amount)}`).join(' · ')}</td>
                    <td className="num" data-label="Transaksi">{x.trx_count ?? '—'}</td>
                    <td data-label="Status"><Badge tone={STATUS[x.status]?.tone}>{STATUS[x.status]?.label}</Badge></td>
                    <td data-label="Dilaporkan">{x.created_by_name}<span className="sub">{dateTime(x.created_at)}</span></td>
                    <td className="num full" data-label="Total">{x.status === 'void' ? <s className="muted">{rp(x.total)}</s> : rp(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {form && <RevenueForm {...form} onClose={() => setForm(null)} />}
      {open && <RevenueDetail id={open} onClose={() => setOpen(null)} onEdit={(report) => { setOpen(null); setForm({ report }); }} />}
    </>
  );
}

function RevenueForm({ report, date: d0, shift: s0, onClose }: { report?: any; date?: string; shift?: string; onClose: () => void }) {
  const { data: opt } = useApi<any>('/master/options');
  const methods: any[] = opt?.revenue_methods ?? [];
  const shifts: string[] = opt?.shifts ?? [];
  const [f, setF] = useState({
    report_date: report?.report_date ?? d0 ?? todayStr(), shift: report?.shift ?? s0 ?? '',
    trx_count: report?.trx_count != null ? String(report.trx_count) : '', notes: report?.notes ?? '',
  });
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries((report?.lines ?? []).filter((l: any) => l.method_id).map((l: any) => [l.method_id, String(l.amount)])));
  const [photos, setPhotos] = useState<Photo[]>(() => (report?.photo_ids ?? []).map((id: number) => ({ id, url: photoUrl(id) })));
  const shift = f.shift || (shifts.length === 1 ? shifts[0]! : '');
  const total = methods.reduce((s, m) => s + (Number(amounts[m.id]) || 0), 0);
  const body = () => ({ ...f, shift, amounts, photo_ids: photos.map((p) => p.id) });
  const save = useAction(() => (report ? api.put(`/revenue/${report.id}`, body()) : api.post('/revenue', body())), {
    success: (r: any) => (report ? 'Laporan dikoreksi' : `${r.number} tercatat`), invalidate: INVALIDATE, onDone: onClose,
  });
  const missing = !shift ? 'Pilih shift' : total <= 0 ? 'Isi nominal minimal satu metode' : '';
  return (
    <Sheet title={report ? `Koreksi ${report.number}` : 'Laporkan pendapatan'} sub="Isi uang yang masuk di shift ini per metode bayar." onClose={onClose} wide
      footer={<><span className="muted" style={{ fontSize: 13 }}>{missing}</span><span className="spacer" /><button className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" disabled={!!missing || save.isPending} onClick={() => save.mutate(undefined)}>Simpan · {rp(total)}</button></>}>
      {!opt ? <Loading /> : !methods.length ? (
        <Empty title="Belum ada metode bayar">Central Admin / Owner perlu menambah metode di Master Data → Metode Pendapatan.</Empty>
      ) : (
        <div className="stack">
          <div className="grid3">
            <Field label="Tanggal"><Input type="date" value={f.report_date} max={todayStr()} onChange={(e) => setF({ ...f, report_date: e.target.value })} /></Field>
            <Field label="Shift">
              {shifts.length === 1 ? <div className="input readonly" style={{ display: 'flex', alignItems: 'center' }}>{shifts[0]}</div>
                : <Seg value={shift} onChange={(v) => setF({ ...f, shift: v })} options={shifts.map((s) => ({ value: s, label: s }))} />}
            </Field>
            <Field label="Jumlah transaksi / nota (opsional)"><Input inputMode="numeric" value={f.trx_count} onChange={(e) => setF({ ...f, trx_count: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <div className="section-title">Uang masuk per metode bayar</div>
          <div className="amounts">
            {methods.map((m) => (
              <Field key={m.id} label={m.name}>
                <Money value={amounts[m.id] ?? ''} onChange={(v) => setAmounts({ ...amounts, [m.id]: v })} />
                <ThousandHint value={amounts[m.id]} onFix={(v) => setAmounts({ ...amounts, [m.id]: v })} />
                {m.pay_account_name && <div className="hint">masuk ke {m.pay_account_name}</div>}
              </Field>
            ))}
          </div>
          <div className="notice ok" style={{ justifyContent: 'space-between' }}><span>Total pendapatan</span><b className="tnum">{rp(total)}</b></div>
          <ExtraPhotos kind="revenue" value={photos} onChange={setPhotos} label="Foto laporan kasir / bukti setor (opsional)" />
          <Field label="Catatan (opsional)"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="mis. ramai karena ada acara, selisih kas Rp5.000" /></Field>
        </div>
      )}
    </Sheet>
  );
}

function RevenueDetail({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (x: any) => void }) {
  const { isAdmin, user } = useSession();
  const { data: x } = useApi<any>(`/revenue/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction(({ url, body }: { url: string; body?: any }) => api.post(url, body), { success: 'Tersimpan', invalidate: INVALIDATE, onDone: () => { setVoiding(false); setNote(''); } });
  if (!x) return <Sheet title="Pendapatan" onClose={onClose}><Loading /></Sheet>;
  const canEdit = x.status === 'submitted' && (isAdmin || x.created_by === user.id);
  return (
    <Sheet title={x.number} sub={<>{date(x.report_date)} · shift {x.shift} · dilaporkan {x.created_by_name} {dateTime(x.created_at)}</>} onClose={onClose} wide
      footer={<>
        <span className="spacer" />
        {isAdmin && x.status !== 'void' && <button className="btn danger" onClick={() => setVoiding(true)}><X size={15} /> Batalkan</button>}
        {isAdmin && x.status === 'verified' && <button className="btn" disabled={act.isPending} onClick={() => act.mutate({ url: `/revenue/${id}/unverify` })}><LockOpen size={15} /> Buka kunci</button>}
        {canEdit && <button className="btn" onClick={() => onEdit(x)}><Pencil size={15} /> Koreksi</button>}
        {isAdmin && x.status === 'submitted' && <button className="btn primary" disabled={act.isPending} onClick={() => act.mutate({ url: `/revenue/${id}/verify` })}><Lock size={15} /> Cek & kunci</button>}
      </>}>
      <div className="stack">
        <div className="row wrap"><Badge tone={STATUS[x.status]?.tone}>{STATUS[x.status]?.label}</Badge>
          {x.verified_at && <span className="muted" style={{ fontSize: 13 }}>dicek {x.verified_by_name} {dateTime(x.verified_at)}</span>}
          {x.updated_at && <span className="muted" style={{ fontSize: 13 }}>dikoreksi {x.updated_by_name} {dateTime(x.updated_at)}</span>}</div>
        {x.voided_at && <div className="notice" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>Dibatalkan {x.voided_by_name} {dateTime(x.voided_at)}: {x.void_note}</div>}
        <div className="panel">
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Metode bayar</th><th>Masuk ke</th><th className="num">Nominal</th></tr></thead>
              <tbody>{x.lines.map((l: any, i: number) => <tr key={i}><td><b>{l.method_name}</b></td><td>{l.pay_account_name ?? <span className="muted">—</span>}</td><td className="num">{rp(l.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={2}>Total</td><td className="num">{rp(x.total)}</td></tr></tfoot>
            </table>
          </div>
        </div>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Jumlah transaksi</dt><dd>{x.trx_count ?? '—'}</dd>
          {x.notes && <><dt>Catatan</dt><dd>{x.notes}</dd></>}
        </dl>
        {x.photo_ids?.length > 0 && <><div className="section-title">Foto</div><PhotoStrip photos={x.photo_ids.map((p: number, i: number) => ({ id: p, label: `Foto ${i + 1}` }))} /></>}
        {x.logs.length > 0 && <><div className="section-title">Riwayat</div><div className="timeline">{x.logs.map((l: any) => <div key={l.id}><span className="muted tnum">{dateTime(l.created_at)}</span><span><b>{l.user_name}</b> — {l.detail}</span></div>)}</div></>}
      </div>
      {voiding && <Confirm title={`Batalkan ${x.number}?`} confirmText="Batalkan laporan" busy={act.isPending || !note.trim()} onConfirm={() => act.mutate({ url: `/revenue/${id}/void`, body: { note } })} onClose={() => setVoiding(false)}
        text={<span className="stack" style={{ gap: 8 }}>Pendapatan ini keluar dari jurnal umum dan shift-nya bisa dilaporkan ulang.<textarea className="input textarea" placeholder="Alasan (wajib)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></span>} />}
    </Sheet>
  );
}
