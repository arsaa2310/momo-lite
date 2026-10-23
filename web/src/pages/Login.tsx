import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Field, Input } from '../ui/kit';
import { Logo } from '../Shell';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/', { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="row" style={{ gap: 10 }}>
          <Logo size={26} />
          <b style={{ fontSize: 20, letterSpacing: '-0.02em' }}>momo lite</b>
        </div>
        <div className="big">
          Pesan barang, terima barang,
          <br />
          catat belanja — <em>tanpa ribet.</em>
        </div>
        <div className="foot">Purchase Order · Belanja Harian · Belanja Karyawan · Jurnal Umum</div>
      </div>
      <div className="login-form">
        <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
          <div>
            <h1>Masuk</h1>
            <p className="muted" style={{ margin: 0 }}>Gunakan email dan kata sandi yang diberikan admin.</p>
          </div>
          <Field label="Email">
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Kata sandi">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <div className="notice" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>{error}</div>}
          <button className="btn primary" style={{ height: 40, justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Memproses…' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
