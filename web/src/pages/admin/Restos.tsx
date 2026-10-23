import { useState } from 'react';
import { Plus, KeyRound } from 'lucide-react';
import { api } from '../../api';
import { useApi, useAction } from '../../ui/hooks';
import { Badge, Confirm, Empty, Field, Input, Loading, PageHead, Select, Sheet, Toggle } from '../../ui/kit';
import { dateTime } from '../../format';

const ROLE = { central: 'Central Admin', purchasing: 'Purchasing (PO)' } as const;

// Panel admin: 1) buat resto, 2) daftarkan Central Admin & orang PO tiap resto, 3) log ada di menu Log Aktivitas.
export default function Restos() {
  const { data, isLoading } = useApi<any[]>('/admin/restos');
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <>
      <PageHead title="Resto & Akun" sub="Buat resto, lalu daftarkan Central Admin dan orang PO (Purchasing) untuk resto itu.">
        <button className="btn primary" onClick={() => setEdit({})}><Plus size={15} /> Resto baru</button>
      </PageHead>
      {isLoading ? <Loading /> : !data?.length ? (
        <div className="panel"><Empty title="Belum ada resto">Klik <b>Resto baru</b> untuk mulai.</Empty></div>
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Resto</th><th>Kode</th><th className="num">Central Admin</th><th className="num">Purchasing</th><th className="num">PO</th><th>Aktivitas terakhir</th><th>Status</th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="click" onClick={() => setEdit(r)}>
                    <td><b>{r.name}</b>{r.address && <span className="sub">{r.address}</span>}</td>
                    <td className="mono">{r.code}</td>
                    <td className="num">{r.central_count || <span className="muted">0</span>}</td>
                    <td className="num">{r.purchasing_count || <span className="muted">0</span>}</td>
                    <td className="num">{r.po_count}</td>
                    <td>{r.last_activity ? dateTime(r.last_activity) : <span className="muted">—</span>}</td>
                    <td>{r.is_active ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {edit && <RestoSheet resto={edit} onClose={() => setEdit(null)} onCreated={setEdit} />}
    </>
  );
}

function RestoSheet({ resto, onClose, onCreated }: { resto: any; onClose: () => void; onCreated: (r: any) => void }) {
  const isNew = !resto.id;
  const [f, setF] = useState({ name: resto.name ?? '', code: resto.code ?? '', address: resto.address ?? '', phone: resto.phone ?? '', is_active: resto.is_active ?? true });
  const save = useAction(() => (isNew ? api.post('/admin/restos', f) : api.put(`/admin/restos/${resto.id}`, f)), {
    success: isNew ? 'Resto dibuat. Sekarang tambahkan akunnya.' : 'Resto disimpan', invalidate: ['/admin'],
    onDone: (r: any) => (isNew ? onCreated(r) : undefined),
  });
  return (
    <Sheet title={isNew ? 'Resto baru' : resto.name} sub={isNew ? undefined : `Kode ${resto.code}`} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Tutup</button><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>{isNew ? 'Buat resto' : 'Simpan resto'}</button></>}>
      <div className="stack">
        <div className="grid2">
          <Field label="Nama resto"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. Bakso Pak Kumis Cabang Depok" /></Field>
          <Field label="Kode" hint="2–8 huruf/angka, dipakai di nomor dokumen: PO-KODE-00001"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={8} className="mono" /></Field>
          <Field label="Alamat"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Telepon"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        {!isNew && (
          <label className="row" style={{ gap: 10 }}>
            <Toggle checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
            <span>Resto aktif <span className="muted">— bila nonaktif, semua akun resto ini tidak bisa masuk</span></span>
          </label>
        )}
        {!isNew && <Users restoId={resto.id} />}
      </div>
    </Sheet>
  );
}

function Users({ restoId }: { restoId: number }) {
  const { data } = useApi<any[]>(`/admin/restos/${restoId}/users`);
  const [f, setF] = useState({ role: 'central', name: '', email: '', password: '' });
  const [shown, setShown] = useState<{ name: string; email: string; password: string } | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  const add = useAction(() => api.post(`/admin/restos/${restoId}/users`, f), {
    success: 'Akun ditambahkan', invalidate: ['/admin'],
    onDone: (r: any) => { if (r.password) setShown({ name: f.name, email: f.email, password: r.password }); setF({ ...f, name: '', email: '', password: '' }); },
  });
  const toggle = useAction((u: any) => api.put(`/admin/users/${u.id}`, { is_active: !u.is_active }), { success: 'Akun diperbarui', invalidate: ['/admin'] });
  const doReset = useAction((u: any) => api.post(`/admin/users/${u.id}/reset-password`), {
    invalidate: ['/admin'], onDone: (r: any) => { setShown({ name: reset.name, email: reset.email, password: r.password }); setReset(null); },
  });
  return (
    <div className="stack">
      <div className="section-title">Akun resto</div>
      {shown && (
        <div className="notice ok" style={{ flexDirection: 'column' }}>
          <b>Kata sandi awal {shown.name} — catat sekarang, hanya ditampilkan sekali:</b>
          <span>Email: <span className="mono">{shown.email}</span> · Kata sandi: <span className="mono" style={{ fontSize: 15 }}>{shown.password}</span></span>
          <button className="btn sm" onClick={() => setShown(null)}>Sudah dicatat</button>
        </div>
      )}
      <div className="panel">
        <div className="table-wrap">
          <table className="t compact">
            <thead><tr><th>Nama</th><th>Peran</th><th>Terakhir masuk</th><th>Status</th><th /></tr></thead>
            <tbody>
              {!data?.length && <tr><td colSpan={5} className="muted">Belum ada akun. Tambahkan Central Admin dan orang PO di bawah.</td></tr>}
              {data?.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.name}</b><span className="sub">{u.email}</span></td>
                  <td>{u.role === 'central' ? <Badge tone="accent">{ROLE.central}</Badge> : <Badge tone="blue">{ROLE.purchasing}</Badge>}</td>
                  <td>{u.last_login_at ? dateTime(u.last_login_at) : <span className="muted">belum pernah</span>}</td>
                  <td><label className="row"><Toggle checked={u.is_active} onChange={() => toggle.mutate(u)} />{u.is_active ? 'Aktif' : 'Nonaktif'}</label></td>
                  <td className="right"><button className="btn sm" onClick={() => setReset(u)}><KeyRound size={13} /> Reset sandi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined); }}>
        <div className="panel-head"><h3>Tambah akun</h3></div>
        <div className="panel-body grid2">
          <Field label="Peran">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={[{ value: 'central', label: 'Central Admin — master data, lihat semua, K/T, jurnal' }, { value: 'purchasing', label: 'Purchasing (PO) — buat PO, terima barang, belanja' }]} />
          </Field>
          <Field label="Nama"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Email (untuk masuk)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <Field label="Kata sandi awal" hint="Kosongkan agar dibuat acak (ditampilkan sekali)"><Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} /></Field>
          <div><button className="btn primary" disabled={add.isPending}><Plus size={15} /> Tambah akun</button></div>
        </div>
      </form>
      {reset && <Confirm title="Reset kata sandi?" text={<>Kata sandi baru untuk <b>{reset.name}</b> dibuat acak dan sesi lamanya langsung berakhir.</>} confirmText="Reset" danger={false}
        busy={doReset.isPending} onConfirm={() => doReset.mutate(reset)} onClose={() => setReset(null)} />}
    </div>
  );
}
