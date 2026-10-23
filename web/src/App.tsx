import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SessionProvider, useSessionQuery } from './session';
import Shell from './Shell';
import Login from './pages/Login';
import Home from './pages/Home';
import PurchaseOrders from './pages/PurchaseOrders';
import Expenses from './pages/Expenses';
import Master from './pages/Master';
import Journal from './pages/Journal';
import Logs from './pages/Logs';
import Account from './pages/Account';
import Restos from './pages/admin/Restos';
import { Loading } from './ui/kit';

export default function App() {
  const me = useSessionQuery();
  const nav = useNavigate();
  const qc = useQueryClient();
  // sesi berakhir di tengah jalan → kembali ke halaman masuk
  useEffect(() => {
    const h = () => { qc.clear(); nav('/login', { replace: true }); };
    window.addEventListener('lite:unauthorized', h);
    return () => window.removeEventListener('lite:unauthorized', h);
  }, []);

  if (me.isLoading) return <Loading />;
  if (!me.data)
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  const role = me.data.user.role;
  return (
    <SessionProvider data={me.data}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<Shell />}>
          {role === 'superadmin' ? (
            <>
              <Route path="/" element={<Restos />} />
              <Route path="/log" element={<Logs admin />} />
            </>
          ) : (
            <>
              <Route path="/" element={<Home />} />
              <Route path="/po" element={<PurchaseOrders />} />
              <Route path="/belanja-harian" element={<Expenses kind="daily" />} />
              <Route path="/belanja-karyawan" element={<Expenses kind="employee" />} />
              {role === 'central' && (
                <>
                  <Route path="/master" element={<Master />} />
                  <Route path="/jurnal" element={<Journal />} />
                  <Route path="/log" element={<Logs />} />
                </>
              )}
            </>
          )}
          <Route path="/akun" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SessionProvider>
  );
}
