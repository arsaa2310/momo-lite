import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api, qs } from '../api';
import { useSession, useSwitchResto } from '../session';
import { useApi, useAction } from '../ui/hooks';
import { Badge, Empty, Input, Loading, PageHead } from '../ui/kit';
import { dateTime, rp, todayStr } from '../format';

const firstOfMonth = () => `${todayStr().slice(0, 7)}-01`;
const ROLE: Record<string, string> = { owner: 'Owner', central: 'Central Admin', manager: 'Manager', purchasing: 'Purchasing' };

// Owner: semua resto miliknya dalam satu layar, kinerja tim resto yang sedang dibuka, dan pengaturan shift laporan pendapatan.
export default function Owner() {
  const { resto, restos } = useSession();
  const switchResto = useSwitchResto();
  const [p, setP] = useState({ from: firstOfMonth(), to: todayStr() });
  const { data, isLoading } = useApi<any>(`/owner/overview${qs(p)}`, { keepPrevious: true });
  const team = useApi<any>(resto ? `/summary/team${qs(p)}` : null, { keepPrevious: true });
  if (!restos.length) return <div className="panel"><Empty title="Belum ada resto">Akun Owner ini belum ditautkan ke resto mana pun. Hubungi admin.</Empty></div>;
  const rows: any[] = data?.restos ?? [];
  const sum = (k: string) => rows.reduce((s, x) => s + Number(x[k] || 0), 0);
  return (
    <>
      <PageHead title="Semua Resto" sub="Uang masuk & keluar, hal yang menunggu persetujuan, dan kelengkapan laporan setiap resto." />
      <div className="toolbar">
        <div className="date-range">
          <Input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} />
          <span className="muted">s/d</span>
          <Input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} />
        </div>
      </div>
      {isLoading ? <Loading /> : (
        <>
          <div className="cashflow">
            <div className="stat"><label>Uang masuk ({rows.length} resto)</label><div className="v in">{rp(sum('revenue'))}</div><div className="d">laporan pendapatan shift</div></div>
            <div className="stat"><label>Uang keluar</label><div className="v out">{rp(sum('spending'))}</div><div className="d">PO diterima + belanja + pengeluaran lain</div></div>
            <div className="stat"><label>Selisih</label><div className="v">{rp(sum('net'))}</div><div className="d">hutang supplier {rp(sum('debt'))}</div></div>
          </div>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head"><h3>Per resto</h3><span className="spacer" /><span className="muted" style={{ fontSize: 13 }}>klik baris untuk membuka resto</span></div>
            <div className="table-wrap">
              <table className="t mcards">
                <thead><tr><th>Resto</th><th className="num">Masuk</th><th className="num">PO diterima</th><th className="num">Belanja</th><th className="num">Lain-lain</th><th className="num">Selisih</th><th>Menunggu</th><th>Laporan shift</th><th>Aktivitas</th></tr></thead>
                <tbody>
                  {rows.map((x) => {
                    const waiting = [x.po_approval && `${x.po_approval} PO`, x.other_approval && `${x.other_approval} pengeluaran`, x.revenue_unverified && `${x.revenue_unverified} pendapatan belum dicek`].filter(Boolean);
                    const complete = x.reports_expected ? x.reports / x.reports_expected : 1;
                    return (
                      <tr key={x.id} className="click" onClick={() => x.id !== resto?.id && switchResto(x.id)}>
                        <td><b>{x.name}</b> <span className="mono muted">{x.code}</span>{x.id === resto?.id && <> <Badge tone="accent">dibuka</Badge></>}</td>
                        <td className="num" data-label="Masuk">{rp(x.revenue)}</td>
                        <td className="num" data-label="PO diterima">{rp(x.po_received)}</td>
                        <td className="num" data-label="Belanja">{rp(Number(x.daily) + Number(x.employee))}</td>
                        <td className="num" data-label="Lain-lain">{rp(x.other)}</td>
                        <td className="num full" data-label="Selisih"><b className={x.net < 0 ? 'down' : ''}>{rp(x.net)}</b></td>
                        <td data-label="Menunggu">{waiting.length ? <span className="down">{waiting.join(' · ')}</span> : <span className="muted">—</span>}</td>
                        <td data-label="Laporan shift"><Badge tone={complete >= 1 ? 'green' : complete >= 0.8 ? 'amber' : 'red'}>{x.reports}/{x.reports_expected}</Badge></td>
                        <td data-label="Aktivitas">{x.last_activity ? dateTime(x.last_activity) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {resto && <Team data={team.data} restoName={resto.name} />}
      {resto && <Shifts key={resto.id} />}
    </>
  );
}

function Team({ data, restoName }: { data: any; restoName: string }) {
  if (!data) return <Loading />;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h3>Kinerja tim — {restoName}</h3></div>
      <div className="table-wrap">
        <table className="t compact mcards">
          <thead><tr><th>Nama</th><th className="num">PO dibuat</th><th className="num">PO disetujui / ditolak</th><th className="num">Terima barang</th><th className="num">Belanja</th><th className="num">Pengeluaran lain</th><th className="num">Laporan pendapatan</th><th className="num">Aktivitas</th><th>Terakhir aktif</th></tr></thead>
          <tbody>
            {data.rows.map((u: any) => (
              <tr key={u.id} style={u.is_active ? undefined : { opacity: 0.55 }}>
                <td><b>{u.name}</b><span className="sub">{ROLE[u.role]}{u.is_active ? '' : ' · nonaktif'}</span></td>
                <td className="num" data-label="PO dibuat">{u.po_created || '—'}</td>
                <td className="num" data-label="PO diputuskan">{u.po_decided || '—'}</td>
                <td className="num" data-label="Terima barang">{u.receipts || '—'}</td>
                <td className="num" data-label="Belanja">{u.expenses ? <>{u.expenses}<span className="sub">{rp(u.expenses_value)}</span></> : '—'}</td>
                <td className="num" data-label="Pengeluaran lain">{u.other || '—'}</td>
                <td className="num" data-label="Laporan pendapatan">{u.revenue_reports || '—'}</td>
                <td className="num" data-label="Aktivitas">{u.activities}</td>
                <td data-label="Terakhir aktif">{u.last_activity ? dateTime(u.last_activity) : <span className="muted">belum pernah</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Nama shift laporan pendapatan resto yang sedang dibuka
function Shifts() {
  const { resto } = useSession();
  const [names, setNames] = useState<string[]>(resto?.shift_names ?? ['Harian']);
  const [draft, setDraft] = useState('');
  const save = useAction(() => api.put('/owner/shifts', { shift_names: names }), { success: 'Shift disimpan', invalidate: ['/revenue', '/master', '/summary', '/owner'] });
  const add = () => { const v = draft.trim(); if (v && !names.some((n) => n.toLowerCase() === v.toLowerCase())) setNames([...names, v]); setDraft(''); };
  const dirty = names.join('|') !== (resto?.shift_names ?? []).join('|');
  return (
    <div className="panel">
      <div className="panel-head"><h3>Shift laporan pendapatan — {resto?.name}</h3></div>
      <div className="panel-body stack" style={{ gap: 10 }}>
        <div className="muted" style={{ fontSize: 13 }}>Manager melaporkan pendapatan sekali per shift. Cukup satu shift (mis. <b>Harian</b>) bila laporannya per hari.</div>
        <div className="chips">
          {names.map((n) => (
            <span key={n} className="chip-edit">{n}
              <button className="btn ghost icon sm" aria-label={`Hapus ${n}`} disabled={names.length === 1} onClick={() => setNames(names.filter((x) => x !== n))}><X size={13} /></button>
            </span>
          ))}
        </div>
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="mis. Pagi, Siang, Malam" maxLength={30} style={{ maxWidth: 240 }} />
          <button className="btn sm" disabled={!draft.trim() || names.length >= 6}><Plus size={14} /> Tambah</button>
          <span className="spacer" />
          <button type="button" className="btn primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(undefined)}>Simpan shift</button>
        </form>
      </div>
    </div>
  );
}
