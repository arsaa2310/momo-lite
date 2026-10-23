import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Field, Input, PageHead } from '../ui/kit';
import { useAction } from '../ui/hooks';

export default function Account() {
  const { user, resto } = useSession();
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const save = useAction(() => {
    if (f.password !== f.confirm) throw new Error('Konfirmasi kata sandi tidak sama');
    return api.put('/auth/password', { current: f.current, password: f.password });
  }, { success: 'Kata sandi diganti', onDone: () => setF({ current: '', password: '', confirm: '' }) });
  return (
    <>
      <PageHead title="Akun Saya" />
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-head"><h3>Profil</h3></div>
          <dl className="kv panel-body" style={{ margin: 0 }}>
            <dt>Nama</dt><dd>{user.name}</dd>
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Peran</dt><dd>{user.role_label}</dd>
            {resto && <><dt>Resto</dt><dd>{resto.name} ({resto.code})</dd></>}
          </dl>
        </div>
        <form className="panel" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          <div className="panel-head"><h3>Ganti kata sandi</h3></div>
          <div className="panel-body stack">
            <Field label="Kata sandi lama"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
            <Field label="Kata sandi baru" hint="Minimal 8 karakter"><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
            <Field label="Ulangi kata sandi baru"><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
            <div><button className="btn primary" disabled={save.isPending}>Simpan</button></div>
          </div>
        </form>
      </div>
    </>
  );
}
