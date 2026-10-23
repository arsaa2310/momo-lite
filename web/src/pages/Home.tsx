import { Link } from 'react-router-dom';
import { useSession } from '../session';
import { useApi } from '../ui/hooks';
import { Badge, Loading, PageHead } from '../ui/kit';
import { date, rp } from '../format';
import { KT } from './PurchaseOrders';

export default function Home() {
  const { user, resto, isCentral } = useSession();
  const { data: s } = useApi<any>('/summary');
  if (!s) return <Loading />;
  const needMaster = isCentral && (!s.item_count || !s.supplier_count);
  return (
    <>
      <PageHead title={`Halo, ${user.name.split(' ')[0]}`} sub={`${resto?.name} · ${user.role_label}`} />
      {needMaster && (
        <div className="notice" style={{ marginBottom: 14 }}>
          Master data belum lengkap ({s.item_count} bahan PO, {s.supplier_count} supplier, {s.expense_item_count} bahan belanja). Isi lewat <Link to="/master" className="link" style={{ marginLeft: 4 }}><b>Master Data → template Excel</b></Link>.
        </div>
      )}
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><label>PO menunggu barang</label><div className="v">{s.po_waiting}</div><div className="d">{s.po_unset ? <span className="down">{s.po_unset} belum ada K/T</span> : 'K/T semua sudah diatur'}</div></div>
        <div className="stat"><label>Barang PO diterima bulan ini</label><div className="v">{rp(s.po_received_month)}</div></div>
        <div className="stat"><label>Hutang supplier (K)</label><div className="v">{rp(s.debt)}</div><div className="d">belum dilunasi</div></div>
        <div className="stat"><label>Belanja harian bulan ini</label><div className="v">{rp(s.daily_month)}</div></div>
        <div className="stat"><label>Belanja karyawan bulan ini</label><div className="v">{rp(s.employee_month)}</div></div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>PO menunggu barang</h3><span className="spacer" /><Link to="/po" className="btn sm">Semua PO</Link></div>
        {!s.waiting.length ? <div className="panel-body muted">Tidak ada PO yang menunggu barang.</div> : (
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Nomor</th><th>Supplier</th><th>K/T</th><th>Status</th><th>Kirim</th><th className="num">Total</th></tr></thead>
              <tbody>
                {s.waiting.map((p: any) => (
                  <tr key={p.id}>
                    <td className="mono">{p.number}</td><td>{p.supplier_name}</td><td><KT terms={p.payment_terms} /></td>
                    <td>{p.status === 'partial' ? <Badge tone="blue">Diterima sebagian</Badge> : <Badge tone="amber">Menunggu barang</Badge>}</td>
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
