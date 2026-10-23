import { useState } from 'react';
import { qs } from '../api';
import { useApi } from '../ui/hooks';
import { Badge, Empty, Field, Input, Loading, PageHead, Pager, SearchBox, Select } from '../ui/kit';
import { dateTime } from '../format';

const ROLE_LABEL: Record<string, string> = { superadmin: 'Super Admin', central: 'Central Admin', purchasing: 'Purchasing' };
const ACTIONS: Record<string, string> = {
  login: 'Masuk', create: 'Buat', update: 'Ubah', delete: 'Hapus', import: 'Impor Excel', export: 'Unduh', receive: 'Terima barang',
  terms: 'K/T', close: 'Tutup sisa', cancel: 'Batal PO', reverse: 'Batal kedatangan', pay: 'Pelunasan', void: 'Batal belanja',
};
const TONE: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'accent'> = { receive: 'green', create: 'blue', terms: 'accent', pay: 'green', delete: 'red', cancel: 'red', void: 'red', reverse: 'red', import: 'amber' };

// Super Admin: semua resto (filter resto). Central Admin: resto sendiri.
export default function Logs({ admin }: { admin?: boolean }) {
  const [f, setF] = useState({ resto_id: '', role: '', action: '', from: '', to: '', q: '', page: 1 });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  const restos = useApi<any[]>(admin ? '/admin/restos' : null);
  const { data, isLoading } = useApi<any>(`${admin ? '/admin/logs' : '/logs'}${qs(f)}`, { keepPrevious: true });
  return (
    <>
      <PageHead title="Log Aktivitas" sub={admin ? 'Semua aktivitas di setiap resto: masuk, PO, terima barang, belanja, impor master data, dan lainnya.' : 'Semua aktivitas di resto ini.'} />
      <div className="toolbar">
        <SearchBox value={f.q} onChange={(v) => set('q', v)} placeholder="Cari isi log / nama…" />
        {admin && <Select value={f.resto_id} onChange={(e) => set('resto_id', e.target.value)} placeholder="Semua resto" options={(restos.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))} />}
        <Select value={f.role} onChange={(e) => set('role', e.target.value)} placeholder="Semua peran" options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select value={f.action} onChange={(e) => set('action', e.target.value)} placeholder="Semua aktivitas" options={Object.entries(ACTIONS).map(([value, label]) => ({ value, label }))} />
        <Field><Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
        <span className="muted">s/d</span>
        <Field><Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
      </div>
      {isLoading ? <Loading /> : !data?.data.length ? <div className="panel"><Empty title="Belum ada log" /></div> : (
        <div className="panel">
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Waktu</th>{admin && <th>Resto</th>}<th>Pengguna</th><th>Aktivitas</th><th>Keterangan</th></tr></thead>
              <tbody>
                {data.data.map((l: any) => (
                  <tr key={l.id}>
                    <td className="tnum">{dateTime(l.created_at)}</td>
                    {admin && <td>{l.resto_name ? <>{l.resto_name} <span className="mono muted">{l.resto_code}</span></> : <span className="muted">—</span>}</td>}
                    <td>{l.user_name ?? '—'}<span className="sub">{ROLE_LABEL[l.user_role] ?? ''}</span></td>
                    <td><Badge tone={TONE[l.action]}>{ACTIONS[l.action] ?? l.action}</Badge></td>
                    <td style={{ whiteSpace: 'normal', minWidth: 280 }}>{l.detail}{l.ip && <span className="sub mono">{l.ip}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} size={data.size} total={data.total} onPage={(p) => set('page', p)} />
        </div>
      )}
    </>
  );
}
