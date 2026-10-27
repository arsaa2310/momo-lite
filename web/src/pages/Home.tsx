import { Link } from 'react-router-dom';
import { useSession } from '../session';
import { useApi } from '../ui/hooks';
import { Badge, Empty, Loading, PageHead } from '../ui/kit';
import { date, rp } from '../format';
import { KT, STATUS } from './PurchaseOrders';

export default function Home() {
  const { user, resto, role, isAdmin, canApprovePo } = useSession();
  const { data: s } = useApi<any>(resto ? '/summary' : null);
  if (!resto) return <div className="panel"><Empty title="Belum ada resto">Akun Owner ini belum ditautkan ke resto mana pun. Hubungi admin.</Empty></div>;
  if (!s) return <Loading />;
  const needMaster = isAdmin && (!s.item_count || !s.supplier_count);
  const money = role !== 'purchasing';
  // daftar tindakan sesuai peran
  const todo = [
    canApprovePo && s.po_approval > 0 && { to: '/po', text: `${s.po_approval} PO menunggu persetujuan Anda` },
    isAdmin && s.other_approval > 0 && { to: '/pengeluaran-lain', text: `${s.other_approval} pengeluaran lain menunggu persetujuan` },
    money && s.missing_shifts.length > 0 && { to: '/pendapatan', text: `Pendapatan hari ini belum dilaporkan: ${s.missing_shifts.join(', ')}` },
    isAdmin && s.revenue_unverified > 0 && { to: '/pendapatan', text: `${s.revenue_unverified} laporan pendapatan belum dicek` },
    isAdmin && s.po_unset > 0 && { to: '/po', text: `${s.po_unset} PO belum ada K/T` },
  ].filter(Boolean) as { to: string; text: string }[];
  return (
    <>
      <PageHead title={`Halo, ${user.name.split(' ')[0]}`} sub={`${resto.name} · ${user.role_label}`} />
      {needMaster && (
        <div className="notice" style={{ marginBottom: 14 }}>
          Master data belum lengkap ({s.item_count} bahan PO, {s.supplier_count} supplier, {s.expense_item_count} bahan belanja). Isi lewat <Link to="/master" className="link" style={{ marginLeft: 4 }}><b>Master Data → template Excel</b></Link>.
        </div>
      )}
      {todo.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h3>Perlu tindakan</h3></div>
          <div className="panel-body stack" style={{ gap: 8 }}>
            {todo.map((t) => <Link key={t.text} to={t.to} className="notice" style={{ textDecoration: 'none' }}>{t.text} →</Link>)}
          </div>
        </div>
      )}
      {money && (
        <div className="cashflow">
          <div className="stat"><label>Uang masuk bulan ini</label><div className="v in">{rp(s.revenue_month)}</div><div className="d">dari laporan pendapatan shift</div></div>
          <div className="stat"><label>Uang keluar bulan ini</label><div className="v out">{rp(s.spending_month)}</div><div className="d">PO diterima + belanja + pengeluaran lain</div></div>
          <div className="stat"><label>Selisih</label><div className="v">{rp(s.net_month)}</div><div className="d">masuk − keluar</div></div>
        </div>
      )}
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><label>PO menunggu barang</label><div className="v">{s.po_waiting}</div><div className="d">{s.po_approval ? <span className="down">{s.po_approval} menunggu persetujuan</span> : s.po_unset ? <span className="down">{s.po_unset} belum ada K/T</span> : 'K/T semua sudah diatur'}</div></div>
        <div className="stat"><label>Barang PO diterima bulan ini</label><div className="v">{rp(s.po_received_month)}</div></div>
        <div className="stat"><label>Hutang supplier (K)</label><div className="v">{rp(s.debt)}</div><div className="d">belum dilunasi</div></div>
        <div className="stat"><label>Belanja harian bulan ini</label><div className="v">{rp(s.daily_month)}</div></div>
        <div className="stat"><label>Belanja karyawan bulan ini</label><div className="v">{rp(s.employee_month)}</div></div>
        {money && <div className="stat"><label>Pengeluaran lain bulan ini</label><div className="v">{rp(s.other_month)}</div></div>}
      </div>
      <div className="panel">
        <div className="panel-head"><h3>PO berjalan</h3><span className="spacer" /><Link to="/po" className="btn sm">Semua PO</Link></div>
        {!s.waiting.length ? <div className="panel-body muted">Tidak ada PO yang menunggu persetujuan atau barang.</div> : (
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Nomor</th><th>Supplier</th><th>Dibuat</th><th>K/T</th><th>Status</th><th>Kirim</th><th className="num">Total</th></tr></thead>
              <tbody>
                {s.waiting.map((p: any) => (
                  <tr key={p.id}>
                    <td className="mono">{p.number}</td><td>{p.supplier_name}</td><td>{p.created_by_name ?? '—'}</td><td><KT terms={p.payment_terms} /></td>
                    <td><Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</Badge></td>
                    <td>{p.expected_date ? date(p.expected_date) : '—'}</td><td className="num">{rp(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
