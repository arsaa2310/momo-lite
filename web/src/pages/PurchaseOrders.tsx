import { useMemo, useState } from 'react';
import { CheckCheck, Plus, Printer, Trash2, Truck, X } from 'lucide-react';
import { api, qs } from '../api';
import { useSession } from '../session';
import { useApi, useAction } from '../ui/hooks';
import { Badge, Confirm, DocCard, DocGrid, Empty, Field, Input, Loading, Money, PageHead, Pager, SearchBox, Seg, Select, Sheet, StageFilter, Suffix, ThousandHint } from '../ui/kit';
import { ExtraPhotos, PhotoInput, PhotoStrip, type Photo } from '../ui/photo';
import { date, dateTime, qty as fq, rp, todayStr } from '../format';

type Status = '' | 'open' | 'partial' | 'received' | 'unset' | 'debt' | 'cancelled';
const STATUS: Record<string, { label: string; tone: 'amber' | 'blue' | 'green' | 'red' }> = {
  open: { label: 'Menunggu barang', tone: 'amber' }, partial: { label: 'Diterima sebagian', tone: 'blue' },
  received: { label: 'Selesai', tone: 'green' }, cancelled: { label: 'Dibatalkan', tone: 'red' },
};

export function KT({ terms, locked }: { terms: string | null; locked?: boolean }) {
  if (!terms) return <span className="kt none" title="K/T belum ditentukan">?</span>;
  const k = terms === 'credit';
  return <span className={`kt ${k ? 'K' : 'T'}`} title={`${k ? 'Kredit / hutang (PKH)' : 'Tunai (PTH)'}${locked ? ' — ditetapkan Central Admin' : ''}`}>{k ? 'K' : 'T'}{locked ? '•' : ''}</span>;
}

export default function PurchaseOrders() {
  const [f, setF] = useState({ status: '' as Status, q: '', from: '', to: '', page: 1 });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  const { data, isLoading } = useApi<any>(`/po${qs(f)}`, { keepPrevious: true });
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const c = data?.counts ?? {};
  return (
    <>
      <PageHead title="Purchase Order" sub="Pesan bahan ke supplier → barang datang (boleh sebagian, wajib foto barang & nota) → K/T ditentukan.">
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> Buat PO</button>
      </PageHead>
      <StageFilter value={f.status} onChange={(v) => set('status', v)} options={[
        { value: '', label: 'Semua' },
        { value: 'open', label: 'Menunggu barang', tone: 'amber', count: c.open },
        { value: 'partial', label: 'Diterima sebagian', tone: 'blue', count: c.partial },
        { value: 'unset', label: 'K/T belum diatur', tone: 'amber', count: c.unset },
        { value: 'debt', label: 'Hutang belum lunas', tone: 'red', count: c.debt },
        { value: 'received', label: 'Selesai', tone: 'green' },
        { value: 'cancelled', label: 'Dibatalkan', tone: 'red' },
      ]} />
      <div className="toolbar">
        <SearchBox value={f.q} onChange={(v) => set('q', v)} placeholder="Cari nomor PO / supplier…" />
        <div className="date-range">
          <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
          <span className="muted">s/d</span>
          <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
        </div>
      </div>
      {isLoading ? <Loading /> : !data?.data.length ? (
        <div className="panel"><Empty title="Belum ada PO">{f.status || f.q ? 'Tidak ada PO yang cocok dengan filter.' : <>Klik <b>Buat PO</b> untuk memesan bahan ke supplier.</>}</Empty></div>
      ) : (
        <>
          <DocGrid>
            {data.data.map((p: any) => (
              <DocCard key={p.id} tone={STATUS[p.status]?.tone} number={p.number} onClick={() => setOpen(p.id)}
                status={<span className="row" style={{ gap: 6 }}><KT terms={p.payment_terms} locked={p.terms_by_central} /><Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</Badge></span>}
                title={p.supplier_name}
                meta={[`${p.line_count} bahan`, date(p.created_at), p.expected_date ? `kirim ${date(p.expected_date)}` : '', p.created_by_name]}
                progress={p.status === 'cancelled' ? null : p.received_pct}
                note={Number(p.debt) > 0 && !p.paid_date ? <span className="down">Hutang {rp(p.debt)}</span> : p.paid_date ? <span className="up">Hutang lunas {date(p.paid_date)}</span> : undefined}
                total={rp(p.total)} />
            ))}
          </DocGrid>
          <div className="panel" style={{ marginTop: 12 }}><Pager page={data.page} size={data.size} total={data.total} onPage={(p) => set('page', p)} /></div>
        </>
      )}
      {creating && <CreatePo onClose={() => setCreating(false)} onCreated={(ids) => { setCreating(false); if (ids.length === 1) setOpen(ids[0]!); }} />}
      {open && <PoDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---------- Buat PO ----------
type Line = { key: number; item_id: string; supplier_id: string; qty: string; unit_cost: string };
let seq = 1;
const newLine = (): Line => ({ key: seq++, item_id: '', supplier_id: '', qty: '', unit_cost: '' });

function CreatePo({ onClose, onCreated }: { onClose: () => void; onCreated: (ids: number[]) => void }) {
  const { data: opt } = useApi<any>('/master/options');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [notes, setNotes] = useState('');
  const [expected, setExpected] = useState('');
  const items = useMemo(() => new Map<number, any>((opt?.items ?? []).map((i: any) => [i.id, i])), [opt]);
  const upd = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: number, id: string) => {
    const it = items.get(Number(id));
    const cheapest = it?.suppliers?.[0];
    upd(key, { item_id: id, supplier_id: cheapest ? String(cheapest.supplier_id) : '', unit_cost: cheapest?.price != null ? String(cheapest.price) : '' });
  };
  const pickSupplier = (key: number, l: Line, sid: string) => {
    const s = items.get(Number(l.item_id))?.suppliers.find((x: any) => String(x.supplier_id) === sid);
    upd(key, { supplier_id: sid, unit_cost: s?.price != null ? String(s.price) : l.unit_cost });
  };
  const filled = lines.filter((l) => l.item_id);
  const groups = new Map<string, number>();
  for (const l of filled) if (l.supplier_id) groups.set(l.supplier_id, (groups.get(l.supplier_id) ?? 0) + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0));
  const supName = (id: string) => opt?.suppliers.find((s: any) => String(s.id) === id)?.name ?? '';
  const save = useAction(() => api.post('/po', {
    notes, expected_date: expected || null,
    lines: filled.map((l) => ({ item_id: Number(l.item_id), supplier_id: Number(l.supplier_id), qty: l.qty, unit_cost: l.unit_cost })),
  }), {
    success: (r: any) => `PO dibuat: ${r.purchase_orders.map((p: any) => p.number).join(', ')}`, invalidate: ['/po', '/summary'],
    onDone: (r: any) => onCreated(r.purchase_orders.map((p: any) => p.id)),
  });
  const noItems = opt && !opt.items.length;
  return (
    <Sheet title="Buat Purchase Order" sub="Satu form boleh beberapa supplier — otomatis dibuat satu PO per supplier." onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn primary" disabled={!filled.length || save.isPending} onClick={() => save.mutate(undefined)}>
        {groups.size > 1 ? `Buat ${groups.size} PO` : 'Buat PO'}</button></>}>
      {!opt ? <Loading /> : noItems ? (
        <Empty title="Belum ada bahan PO">Central Admin perlu mengisi master data (Bahan PO, Supplier, Harga Supplier) lewat template Excel.</Empty>
      ) : (
        <div className="stack">
          <table className="lines">
            <thead><tr><th style={{ width: '32%' }}>Bahan</th><th style={{ width: '28%' }}>Supplier</th><th>Jumlah</th><th>Harga / satuan</th><th className="right">Subtotal</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => {
                const it = items.get(Number(l.item_id));
                const sups = it?.suppliers ?? [];
                return (
                  <tr key={l.key}>
                    <td data-label="Bahan"><Select value={l.item_id} onChange={(e) => pickItem(l.key, e.target.value)} placeholder="— Pilih bahan —"
                      options={opt.items.map((i: any) => ({ value: i.id, label: `${i.name} (${i.unit})${i.suppliers.length ? '' : ' — belum ada supplier'}` }))} /></td>
                    <td data-label="Supplier" className="full">
                      <Select value={l.supplier_id} onChange={(e) => pickSupplier(l.key, l, e.target.value)} disabled={!it} placeholder={it && !sups.length ? 'Belum ada supplier' : '— Supplier —'}
                        options={sups.map((s: any, i: number) => ({ value: s.supplier_id, label: `${s.name} · ${s.price != null ? rp(s.price) : 'tanpa harga'}${i === 0 && sups.length > 1 ? ' (termurah)' : ''}` }))} />
                    </td>
                    <td data-label="Jumlah"><Suffix value={l.qty} onChange={(v) => upd(l.key, { qty: v })} suffix={it?.unit ?? '—'} /></td>
                    <td data-label="Harga"><Money value={l.unit_cost} onChange={(v) => upd(l.key, { unit_cost: v })} /><ThousandHint value={l.unit_cost} onFix={(v) => upd(l.key, { unit_cost: v })} /></td>
                    <td data-label="Subtotal" className="right tnum cell-text full">{rp((Number(l.qty) || 0) * (Number(l.unit_cost) || 0))}</td>
                    <td className="x"><button className="btn ghost icon" aria-label="Hapus baris" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}><Trash2 size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>Jumlah boleh desimal, pakai koma — mis. 0,5 atau 1,25.</div>
          <div><button className="btn sm" onClick={() => setLines((ls) => [...ls, newLine()])}><Plus size={14} /> Tambah bahan</button></div>
          <div className="grid2">
            <Field label="Tanggal kirim diharapkan (opsional)"><Input type="date" value={expected} min={todayStr()} onChange={(e) => setExpected(e.target.value)} /></Field>
            <Field label="Catatan (opsional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. untuk stok akhir pekan" /></Field>
          </div>
          {groups.size > 0 && (
            <div className="panel">
              <div className="panel-head"><h3>Ringkasan</h3><span className="spacer" /><span className="muted" style={{ fontSize: 13 }}>{groups.size} PO akan dibuat</span></div>
              <div className="table-wrap"><table className="t compact"><tbody>
                {[...groups].map(([sid, total]) => <tr key={sid}><td>{supName(sid)}</td><td className="num">{rp(total)}</td></tr>)}
              </tbody><tfoot><tr><td>Total</td><td className="num">{rp([...groups.values()].reduce((a, b) => a + b, 0))}</td></tr></tfoot></table></div>
            </div>
          )}
          <div className="notice info">K/T (kredit / tunai) ditetapkan Central Admin. Bila belum diatur, dipilih saat barang pertama datang.</div>
        </div>
      )}
    </Sheet>
  );
}

// ---------- Detail PO ----------
function PoDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { isCentral, user } = useSession();
  const { data: p, isLoading } = useApi<any>(`/po/${id}`);
  const [receiving, setReceiving] = useState(false);
  const [dialog, setDialog] = useState<null | 'cancel' | 'close' | 'unpay' | { reverse: any }>(null);
  const [note, setNote] = useState('');
  const inv = ['/po', '/summary', '/journal', '/logs'];
  const act = useAction(({ url, body, method }: { url: string; body?: any; method?: 'del' }) => (method === 'del' ? api.del(url) : api.post(url, body)),
    { success: 'Tersimpan', invalidate: inv, onDone: () => { setDialog(null); setNote(''); } });
  if (isLoading || !p) return <Sheet title="Purchase Order" onClose={onClose} wide><Loading /></Sheet>;
  const st = STATUS[p.status];
  const canReceive = ['open', 'partial'].includes(p.status);
  const total = p.lines.reduce((s: number, l: any) => s + Number(l.qty) * Number(l.unit_cost), 0);
  const canCancel = p.status === 'open' && (isCentral || p.created_by === user.id);
  return (
    <Sheet title={p.number} sub={<>{p.supplier_name} · dibuat {dateTime(p.created_at)} oleh {p.created_by_name ?? '—'}</>} onClose={onClose} wide
      footer={<>
        <button className="btn" onClick={() => window.print()}><Printer size={15} /> Cetak PO</button>
        <span className="spacer" />
        {canCancel && <button className="btn danger" onClick={() => setDialog('cancel')}><X size={15} /> Batalkan PO</button>}
        {p.status === 'partial' && <button className="btn" onClick={() => setDialog('close')}><CheckCheck size={15} /> Tutup sisa PO</button>}
        {canReceive && <button className="btn primary" onClick={() => setReceiving(true)}><Truck size={15} /> Terima barang</button>}
      </>}>
      <div className="stack">
        <div className="row wrap">
          <Badge tone={st?.tone}>{st?.label}</Badge>
          <span className="row" style={{ gap: 6 }}><KT terms={p.payment_terms} locked={p.terms_by_central} />
            <span className="muted" style={{ fontSize: 13 }}>{p.payment_terms === 'credit' ? 'Kredit / hutang' : p.payment_terms === 'cash' ? 'Tunai' : 'K/T belum ditentukan'}{p.terms_by_central ? ' (Central Admin)' : p.payment_terms ? ' (dipilih penerima)' : ''}</span></span>
          {p.expected_date && <span className="tag">Kirim {date(p.expected_date)}</span>}
          {p.due_date && <span className="tag">Jatuh tempo {date(p.due_date)}</span>}
        </div>
        {p.notes && <div className="notice info">{p.notes}</div>}
        {p.close_note && <div className="notice">{p.status === 'cancelled' ? 'Dibatalkan' : 'Sisa ditutup'} oleh {p.closed_by_name}: {p.close_note}</div>}

        <div className="panel">
          <div className="table-wrap">
            <table className="t compact mcards">
              <thead><tr><th>Bahan</th><th className="num">Dipesan</th><th className="num">Diterima</th><th className="num">Harga PO</th><th className="num">Subtotal</th></tr></thead>
              <tbody>
                {p.lines.map((l: any) => {
                  const done = Number(l.received_qty) >= Number(l.qty);
                  return (
                    <tr key={l.id}>
                      <td><b>{l.name}</b><span className="sub">{l.sub_category ?? l.category ?? ''}</span></td>
                      <td className="num" data-label="Dipesan">{fq(l.qty)} {l.unit}</td>
                      <td className="num" data-label="Diterima"><span className={done ? 'up' : Number(l.received_qty) > 0 ? '' : 'muted'}>{fq(l.received_qty)}</span>{Number(l.received_qty) > Number(l.qty) && <span className="sub">lebih {fq(Number(l.received_qty) - Number(l.qty))}</span>}</td>
                      <td className="num" data-label="Harga PO">{rp(l.unit_cost)}</td>
                      <td className="num" data-label="Subtotal">{rp(Number(l.qty) * Number(l.unit_cost))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={4}>Total PO</td><td className="num">{rp(total)}</td></tr></tfoot>
            </table>
          </div>
        </div>

        {isCentral && p.status !== 'cancelled' && <TermsPanel p={p} />}

        <div className="section-title">Kedatangan barang ({p.receipts.length})</div>
        {!p.receipts.length && <div className="muted" style={{ fontSize: 13 }}>Belum ada barang datang.</div>}
        {p.receipts.map((rc: any) => (
          <div key={rc.id} className="arrival" style={rc.reversed_at ? { opacity: 0.6 } : undefined}>
            <div className="arrival-head">
              <b className="mono">{rc.number}</b>
              <span>{dateTime(rc.received_at)} · {rc.received_by_name}</span>
              <span className="spacer" />
              {rc.reversed_at ? <Badge tone="red">Dibatalkan</Badge> : rc.paid ? <Badge tone="green">T · lunas {rc.pay_account_name}</Badge> : <Badge tone="blue">K · hutang</Badge>}
              <b className="tnum">{rp(rc.value)}</b>
              {isCentral && !rc.reversed_at && <button className="btn sm ghost danger" onClick={() => setDialog({ reverse: rc })}>Batalkan</button>}
            </div>
            <div className="arrival-body">
              <div className="arrival-items">
                {rc.lines.map((l: any) => (
                  <div key={l.po_line_id} className="row arrival-line">
                    <span style={{ flex: 1 }}>{l.name}</span>
                    <span className="tnum">{fq(l.qty)} {l.unit}{Number(l.excess_qty) > 0 && <span className="muted"> (lebih {fq(l.excess_qty)})</span>}</span>
                    <span className="tnum arrival-price">
                      {Number(l.unit_cost) !== Number(l.po_unit_cost) ? <><s className="muted">{rp(l.po_unit_cost)}</s> {rp(l.unit_cost)}</> : rp(l.unit_cost)}
                    </span>
                  </div>
                ))}
                {(Number(rc.ppn) > 0 || Number(rc.discount) > 0) && <div className="muted" style={{ fontSize: 12.5 }}>PPN {rp(rc.ppn)} · Diskon {rp(rc.discount)}</div>}
                {rc.excess_note && <div className="notice" style={{ marginTop: 4 }}>Kelebihan: {rc.excess_note}</div>}
                {rc.price_note && <div className="notice" style={{ marginTop: 4 }}>Selisih harga: {rc.price_note}</div>}
                {rc.notes && <div className="muted" style={{ fontSize: 13 }}>Catatan: {rc.notes}</div>}
                {rc.reversed_at && <div className="notice" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>Dibatalkan {rc.reversed_by_name} {dateTime(rc.reversed_at)}: {rc.reverse_note}</div>}
              </div>
              <PhotoStrip photos={[{ id: rc.goods_photo_id, label: 'Barang' }, { id: rc.receipt_photo_id, label: 'Nota' }, ...(rc.extra_photo_ids ?? []).map((x: number, i: number) => ({ id: x, label: `Foto ${i + 1}` }))]} />
            </div>
          </div>
        ))}

        {p.logs.length > 0 && (
          <>
            <div className="section-title">Riwayat</div>
            <div className="timeline">
              {p.logs.map((l: any) => <div key={l.id}><span className="muted tnum">{dateTime(l.created_at)}</span><span><b>{l.user_name}</b> — {l.detail}</span></div>)}
            </div>
          </>
        )}
      </div>
      <PrintPo p={p} total={total} />
      {receiving && <ReceiveSheet p={p} onClose={() => setReceiving(false)} />}
      {dialog === 'cancel' && <NoteDialog title="Batalkan PO?" text="PO dibatalkan sebelum barang datang. Isi alasannya." confirm="Batalkan PO" note={note} setNote={setNote} busy={act.isPending}
        onConfirm={() => act.mutate({ url: `/po/${p.id}/cancel`, body: { note } })} onClose={() => setDialog(null)} />}
      {dialog === 'close' && <NoteDialog title="Tutup sisa PO?" text="Sisa barang yang belum datang dianggap tidak dikirim dan PO selesai." confirm="Tutup sisa" note={note} setNote={setNote} busy={act.isPending}
        onConfirm={() => act.mutate({ url: `/po/${p.id}/close`, body: { note } })} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && <NoteDialog title={`Batalkan kedatangan ${dialog.reverse.number}?`} text="Jumlah diterima PO dikurangi dan kedatangan ini keluar dari jurnal umum." confirm="Batalkan kedatangan"
        note={note} setNote={setNote} busy={act.isPending} onConfirm={() => act.mutate({ url: `/po/${p.id}/receipts/${dialog.reverse.id}/reverse`, body: { note } })} onClose={() => setDialog(null)} />}
    </Sheet>
  );
}

function NoteDialog({ title, text, confirm, note, setNote, busy, onConfirm, onClose }: { title: string; text: string; confirm: string; note: string; setNote: (v: string) => void; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Confirm title={title} busy={busy || !note.trim()} confirmText={confirm} onConfirm={onConfirm} onClose={onClose}
      text={<span className="stack" style={{ gap: 8 }}>{text}<textarea className="input textarea" placeholder="Alasan (wajib)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></span>} />
  );
}

// K/T, jatuh tempo, pelunasan hutang — Central Admin
function TermsPanel({ p }: { p: any }) {
  const { data: opt } = useApi<any>('/master/options');
  const [terms, setTerms] = useState<string>(p.payment_terms ?? '');
  const [due, setDue] = useState<string>(p.due_date ?? '');
  const [acc, setAcc] = useState('');
  const [pay, setPay] = useState({ date: todayStr(), account: '', photo: null as Photo | null });
  const [unpay, setUnpay] = useState(false);
  const hasReceipts = p.receipts.some((r: any) => !r.reversed_at);
  const switchingToCash = hasReceipts && terms === 'cash' && p.payment_terms !== 'cash';
  const inv = ['/po', '/summary', '/journal', '/logs'];
  const saveTerms = useAction(() => api.put(`/po/${p.id}/terms`, { payment_terms: terms, due_date: due || null, pay_account_id: acc || null }), { success: 'K/T disimpan', invalidate: inv });
  const doPay = useAction(() => api.post(`/po/${p.id}/pay`, { paid_date: pay.date, pay_account_id: pay.account, photo_id: pay.photo?.id }), { success: 'Hutang ditandai lunas', invalidate: inv });
  const doUnpay = useAction(() => api.del(`/po/${p.id}/pay`), { success: 'Pelunasan dibatalkan', invalidate: inv, onDone: () => setUnpay(false) });
  const accounts = (opt?.accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }));
  const dirty = terms !== (p.payment_terms ?? '') || !p.terms_by_central || due !== (p.due_date ?? '');
  return (
    <div className="panel">
      <div className="panel-head"><h3>Pembayaran (Central Admin)</h3></div>
      <div className="panel-body stack">
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Field label="K/T"><Seg value={terms} onChange={setTerms} options={[{ value: 'credit', label: 'K — Kredit / hutang' }, { value: 'cash', label: 'T — Tunai' }]} /></Field>
          {terms === 'credit' && <Field label="Jatuh tempo"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
          {switchingToCash && <Field label="Dibayar dari"><Select value={acc} onChange={(e) => setAcc(e.target.value)} placeholder="— Kas / rekening —" options={accounts} /></Field>}
          <button className="btn primary" disabled={!terms || !dirty || saveTerms.isPending || (switchingToCash && !acc)} onClick={() => saveTerms.mutate(undefined)}>
            {p.terms_by_central ? 'Simpan' : 'Tetapkan K/T'}
          </button>
        </div>
        {!p.terms_by_central && <div className="muted" style={{ fontSize: 13 }}>Setelah ditetapkan, penerima barang tidak bisa mengubah K/T.{hasReceipts && p.payment_terms ? ' K/T saat ini dipilih penerima.' : ''}</div>}
        {p.payment_terms === 'credit' && hasReceipts && (
          p.paid_date ? (
            <div className="notice ok" style={{ alignItems: 'center' }}>
              <span style={{ flex: 1 }}>Hutang lunas {date(p.paid_date)} dari {p.paid_account_name} · dicatat {p.paid_by_name}</span>
              {p.paid_photo_id && <PhotoStrip photos={[{ id: p.paid_photo_id, label: 'Bukti' }]} />}
              <button className="btn sm" onClick={() => setUnpay(true)}>Batalkan pelunasan</button>
            </div>
          ) : Number(p.debt) > 0 && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="notice">Hutang belum lunas: <b style={{ marginLeft: 4 }}>{rp(p.debt)}</b></div>
              <div className="grid3" style={{ alignItems: 'end' }}>
                <Field label="Tanggal bayar"><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
                <Field label="Dari kas / rekening"><Select value={pay.account} onChange={(e) => setPay({ ...pay, account: e.target.value })} placeholder="— Pilih —" options={accounts} /></Field>
                <button className="btn primary" disabled={!pay.account || doPay.isPending} onClick={() => doPay.mutate(undefined)}>Tandai lunas</button>
              </div>
              <div style={{ maxWidth: 260 }}><PhotoInput label="Bukti bayar (opsional)" kind="payment" value={pay.photo} onChange={(v) => setPay({ ...pay, photo: v })} /></div>
            </div>
          )
        )}
      </div>
      {unpay && <Confirm title="Batalkan pelunasan?" text="Hutang PO ini kembali tercatat belum lunas." confirmText="Batalkan pelunasan" busy={doUnpay.isPending} onConfirm={() => doUnpay.mutate(undefined)} onClose={() => setUnpay(false)} />}
    </div>
  );
}

// ---------- Terima barang ----------
function ReceiveSheet({ p, onClose }: { p: any; onClose: () => void }) {
  const { data: opt } = useApi<any>('/master/options');
  const remaining = (l: any) => Math.max(0, Math.round((Number(l.qty) - Number(l.received_qty)) * 1000) / 1000);
  const [received, setReceived] = useState<Record<number, string>>(() => Object.fromEntries(p.lines.map((l: any) => [l.id, remaining(l) ? String(remaining(l)) : ''])));
  const [prices, setPrices] = useState<Record<number, string>>(() => Object.fromEntries(p.lines.map((l: any) => [l.id, String(l.unit_cost)])));
  const firstArrival = !p.receipts.some((r: any) => !r.reversed_at);
  const lockedTerms = p.terms_by_central || (!firstArrival && p.payment_terms);
  const [terms, setTerms] = useState<string>(p.payment_terms ?? p.supplier_terms ?? '');
  const [f, setF] = useState({ pay_account_id: '', ppn: '', discount: '', excess_note: '', price_note: '', notes: '' });
  const [goods, setGoods] = useState<Photo | null>(null);
  const [nota, setNota] = useState<Photo | null>(null);
  const [extra, setExtra] = useState<Photo[]>([]);
  const effTerms = lockedTerms ? p.payment_terms : terms;
  const excess = p.lines.some((l: any) => (Number(received[l.id]) || 0) > remaining(l));
  const priceDiff = p.lines.some((l: any) => (Number(received[l.id]) || 0) > 0 && Math.abs((Number(prices[l.id]) || 0) - Number(l.unit_cost)) > 0.005);
  const gross = p.lines.reduce((s: number, l: any) => s + (Number(received[l.id]) || 0) * (Number(prices[l.id]) || 0), 0);
  const value = gross - (Number(f.discount) || 0) + (Number(f.ppn) || 0);
  const save = useAction(() => api.post(`/po/${p.id}/receive`, {
    received, prices, ...f, payment_terms: lockedTerms ? undefined : terms,
    goods_photo_id: goods?.id, receipt_photo_id: nota?.id, extra_photo_ids: extra.map((x) => x.id),
  }), { success: (r: any) => `${r.number} tercatat${r.complete ? ' — PO selesai' : ''}`, invalidate: ['/po', '/summary', '/journal', '/logs'], onDone: onClose });
  const missing = !goods ? 'Lampirkan foto barang' : !nota ? 'Lampirkan foto nota' : !effTerms ? 'Pilih K/T' : effTerms === 'cash' && !f.pay_account_id ? 'Pilih kas / rekening'
    : excess && !f.excess_note.trim() ? 'Isi catatan kelebihan' : priceDiff && !f.price_note.trim() ? 'Isi catatan selisih harga' : gross <= 0 ? 'Isi jumlah datang' : '';
  return (
    <Sheet title={`Terima barang — ${p.number}`} sub={p.supplier_name} onClose={onClose} wide
      footer={<><span className="muted" style={{ fontSize: 13 }}>{missing}</span><span className="spacer" /><button className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" disabled={!!missing || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending ? 'Menyimpan…' : `Simpan kedatangan · ${rp(value)}`}</button></>}>
      <div className="stack">
        <table className="lines">
          <thead><tr><th style={{ width: '34%' }}>Bahan</th><th>Sisa pesanan</th><th>Jumlah datang</th><th>Harga nota / satuan</th><th className="right">Subtotal</th></tr></thead>
          <tbody>
            {p.lines.map((l: any) => {
              const qn = Number(received[l.id]) || 0;
              const over = qn > remaining(l);
              const diff = qn > 0 && Math.abs((Number(prices[l.id]) || 0) - Number(l.unit_cost)) > 0.005;
              return (
                <tr key={l.id}>
                  <td data-label="Bahan"><b>{l.name}</b><div className="muted" style={{ fontSize: 12 }}>dipesan {fq(l.qty)} {l.unit} · diterima {fq(l.received_qty)}</div></td>
                  <td data-label="Sisa pesanan" className="tnum cell-text">{fq(remaining(l))} {l.unit}</td>
                  <td data-label="Jumlah datang"><Suffix value={received[l.id]} onChange={(v) => setReceived({ ...received, [l.id]: v })} suffix={l.unit} className={over ? 'warn' : ''} /></td>
                  <td data-label="Harga nota"><Money value={prices[l.id]} onChange={(v) => setPrices({ ...prices, [l.id]: v })} className={diff ? 'warn' : ''} />
                    <ThousandHint value={prices[l.id]} onFix={(v) => setPrices({ ...prices, [l.id]: v })} />
                    {diff && <div className="muted" style={{ fontSize: 12 }}>harga PO {rp(l.unit_cost)}</div>}</td>
                  <td data-label="Subtotal" className="right tnum cell-text">{rp(qn * (Number(prices[l.id]) || 0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>Isi 0 untuk bahan yang belum datang. Jumlah boleh desimal, pakai koma — mis. 0,5.</div>
        {excess && <Field label="Catatan kelebihan barang (wajib)" hint="Jumlah datang melebihi sisa pesanan"><Input className="warn" value={f.excess_note} onChange={(e) => setF({ ...f, excess_note: e.target.value })} placeholder="mis. bonus dari supplier / salah kirim" /></Field>}
        {priceDiff && <Field label="Catatan selisih harga (wajib)" hint="Harga nota berbeda dari harga PO"><Input className="warn" value={f.price_note} onChange={(e) => setF({ ...f, price_note: e.target.value })} placeholder="mis. harga naik per minggu ini" /></Field>}

        <div className="grid3">
          <Field label="PPN nota (opsional)"><Money value={f.ppn} onChange={(v) => setF({ ...f, ppn: v })} /></Field>
          <Field label="Diskon nota (opsional)"><Money value={f.discount} onChange={(v) => setF({ ...f, discount: v })} /></Field>
          <Field label="Total kedatangan"><div className="input readonly tnum" style={{ display: 'flex', alignItems: 'center', fontWeight: 600 }}>{rp(value)}</div></Field>
        </div>

        <div className="panel">
          <div className="panel-body stack" style={{ gap: 10 }}>
            <div className="row wrap" style={{ alignItems: 'flex-end', gap: 12 }}>
              <Field label="Pembayaran (K/T)">
                {lockedTerms
                  ? <div className="row" style={{ height: 34 }}><KT terms={p.payment_terms} locked={p.terms_by_central} /> {p.payment_terms === 'credit' ? 'Kredit / hutang' : 'Tunai'} <span className="muted">— {p.terms_by_central ? 'ditetapkan Central Admin' : 'dipilih di kedatangan pertama'}</span></div>
                  : <Seg value={terms} onChange={setTerms} options={[{ value: 'credit', label: 'K — Kredit / hutang' }, { value: 'cash', label: 'T — Tunai' }]} />}
              </Field>
              {effTerms === 'cash' && <Field label="Dibayar dari"><Select value={f.pay_account_id} onChange={(e) => setF({ ...f, pay_account_id: e.target.value })} placeholder="— Kas / rekening —" options={(opt?.accounts ?? []).map((a: any) => ({ value: a.id, label: a.name }))} /></Field>}
            </div>
            {!lockedTerms && <div className="muted" style={{ fontSize: 12.5 }}>K/T belum ditetapkan Central Admin.{p.supplier_terms ? ` Usulan dari supplier: ${p.supplier_terms === 'credit' ? 'K' : 'T'}.` : ''}</div>}
          </div>
        </div>

        <div className="photo-grid">
          <PhotoInput label="Foto barang yang datang (wajib)" kind="receiving" value={goods} onChange={setGoods} />
          <PhotoInput label="Foto nota / struk supplier (wajib)" kind="receiving" value={nota} onChange={setNota} />
        </div>
        <ExtraPhotos kind="receiving" value={extra} onChange={setExtra} />
        <Field label="Catatan (opsional)"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="mis. kondisi barang, nama kurir" /></Field>
      </div>
    </Sheet>
  );
}

// Dokumen A4 untuk dicetak (Ctrl+P / tombol Cetak PO)
function PrintPo({ p, total }: { p: any; total: number }) {
  return (
    <div className="print-doc">
      <div className="pd-head">
        <div><div className="pd-biz">{p.resto_name}</div><div className="pd-muted">{[p.resto_address, p.resto_phone].filter(Boolean).join(' · ')}</div></div>
        <div style={{ textAlign: 'right' }}><div className="pd-title">PURCHASE ORDER</div><div className="pd-no">{p.number}</div><div className="pd-muted">{date(p.created_at)}</div></div>
      </div>
      <div className="pd-parties">
        <div><div className="pd-label">Supplier</div><b>{p.supplier_name}</b><div>{p.supplier_contact}</div><div>{p.supplier_phone}</div><div>{p.supplier_address}</div></div>
        <div><div className="pd-label">Pembayaran</div>{p.payment_terms === 'credit' ? `K — Kredit${p.due_date ? `, jatuh tempo ${date(p.due_date)}` : ''}` : p.payment_terms === 'cash' ? 'T — Tunai' : '—'}
          {p.expected_date && <><div className="pd-label" style={{ marginTop: 8 }}>Tanggal kirim</div>{date(p.expected_date)}</>}</div>
      </div>
      <table className="pd-table">
        <thead><tr><th>No</th><th>Bahan</th><th className="r">Jumlah</th><th>Satuan</th><th className="r">Harga</th><th className="r">Subtotal</th></tr></thead>
        <tbody>{p.lines.map((l: any, i: number) => <tr key={l.id}><td>{i + 1}</td><td>{l.name}</td><td className="r">{fq(l.qty)}</td><td>{l.unit}</td><td className="r">{rp(l.unit_cost)}</td><td className="r">{rp(Number(l.qty) * Number(l.unit_cost))}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={5} className="r"><b>Total</b></td><td className="r"><b>{rp(total)}</b></td></tr></tfoot>
      </table>
      {p.notes && <div>Catatan: {p.notes}</div>}
      <div className="pd-sign">
        <div>Dibuat oleh<div className="pd-line" />{p.created_by_name}</div>
        <div>Diterima oleh<div className="pd-line" />{p.receipts.find((r: any) => !r.reversed_at)?.received_by_name ?? ''}</div>
        <div>Supplier<div className="pd-line" />{p.supplier_name}</div>
      </div>
    </div>
  );
}
