import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { download, qs } from '../api';
import { useApi } from '../ui/hooks';
import { useToast } from '../ui/toast';
import { Empty, Input, Loading, PageHead, Seg } from '../ui/kit';
import { date, qty as fq, rp, todayStr } from '../format';

const firstOfMonth = () => `${todayStr().slice(0, 7)}-01`;
const n0 = (v: any) => (v == null || v === '' ? '' : rp(v));

// Jurnal umum (buku pembelian): PO (PTH / PKH) + belanja harian & karyawan (PTH), format kolom sama dengan momo.
export default function Journal() {
  const [p, setP] = useState({ from: firstOfMonth(), to: todayStr() });
  const [term, setTerm] = useState<'' | 'PTH' | 'PKH'>('');
  const { data, isLoading } = useApi<any>(`/journal${qs(p)}`, { keepPrevious: true });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const exportXlsx = async () => {
    setBusy(true);
    try { await download(`/journal/export${qs(p)}`, 'jurnal-umum.xlsx'); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const rows = (data?.rows ?? []).filter((r: any) => !term || r.term === term);
  const t = data?.totals;
  return (
    <>
      <PageHead title="Jurnal Umum" sub="Buku pembelian: kedatangan PO (PTH tunai / PKH kredit) dan belanja harian & karyawan (PTH).">
        <button className="btn primary" disabled={busy} onClick={exportXlsx}><FileSpreadsheet size={15} /> {busy ? 'Menyiapkan…' : 'Ekspor Excel'}</button>
      </PageHead>
      <div className="toolbar">
        <Input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} style={{ width: 150 }} />
        <span className="muted">s/d</span>
        <Input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} style={{ width: 150 }} />
        <Seg value={term} onChange={setTerm} options={[{ value: '', label: 'Semua' }, { value: 'PTH', label: 'PTH' }, { value: 'PKH', label: 'PKH' }]} />
      </div>
      {t && (
        <div className="stats" style={{ marginBottom: 14 }}>
          <div className="stat"><label>Total pembelian</label><div className="v">{rp(t.all)}</div><div className="d">{date(data.from)} – {date(data.to)}</div></div>
          <div className="stat"><label>PTH (tunai)</label><div className="v">{rp(t.pth)}</div></div>
          <div className="stat"><label>PKH (kredit / hutang)</label><div className="v">{rp(t.pkh)}</div><div className="d">{t.unpaid ? <span className="down">{rp(t.unpaid)} belum dibayar</span> : 'semua lunas'}</div></div>
          <div className="stat"><label>PO · Harian · Karyawan</label><div className="v" style={{ fontSize: 15 }}>{rp(t.po)}</div><div className="d">{rp(t.daily)} · {rp(t.employee)}</div></div>
        </div>
      )}
      {isLoading ? <Loading /> : !rows.length ? <div className="panel"><Empty title="Tidak ada transaksi di periode ini" /></div> : (
        <div className="panel">
          <div className="table-wrap">
            <table className="t register">
              <thead><tr>
                <th>Tanggal</th><th>Term</th><th>Kode</th><th>Supplier</th><th>Barang</th><th>Sub Kategori</th><th>Kategori</th>
                <th className="num">Qty</th><th>Unit</th><th className="num">Harga</th><th className="num">PPN</th><th className="num">Sub Total</th><th className="num">Diskon</th><th className="num">TOTAL</th>
                <th>Tgl Bayar</th><th>Rekening</th><th>CR/DB</th><th>No. Dokumen</th>
              </tr></thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i} className={r.total != null && !term ? 'group-end' : ''}>
                    <td>{date(r.date)}</td><td><b>{r.term}</b></td><td className="mono">{r.code}</td><td>{r.supplier}</td><td>{r.item}</td>
                    <td>{r.sub_category ?? ''}</td><td>{r.category ?? ''}</td><td className="num">{fq(r.qty)}</td><td>{r.unit ?? ''}</td>
                    <td className="num">{rp(r.price)}</td><td className="num">{n0(r.ppn)}</td><td className="num">{rp(r.subtotal)}</td><td className="num">{n0(r.discount)}</td>
                    <td className="num"><b>{!term && r.total != null ? rp(r.total) : ''}</b></td>
                    <td>{r.paid_date ? date(r.paid_date) : <span className="down">belum</span>}</td><td>{r.rekening ?? ''}</td><td>{r.crdb}</td><td className="mono">{r.ref}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={13}>Total {term || 'pembelian'}</td><td className="num">{rp(rows.reduce((s: number, r: any) => s + r.subtotal - (r.discount ?? 0) + (r.ppn ?? 0), 0))}</td><td colSpan={4} /></tr></tfoot>
            </table>
          </div>
        </div>
      )}
      {data?.recap?.length > 0 && (
        <div className="panel" style={{ marginTop: 14, maxWidth: 720 }}>
          <div className="panel-head"><h3>Rekap per kategori</h3></div>
          <div className="table-wrap">
            <table className="t compact">
              <thead><tr><th>Kategori</th><th className="num">PTH</th><th className="num">PKH</th><th className="num">Total</th></tr></thead>
              <tbody>{data.recap.map((x: any) => <tr key={x.category}><td>{x.category}</td><td className="num">{rp(x.pth)}</td><td className="num">{rp(x.pkh)}</td><td className="num">{rp(x.total)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
