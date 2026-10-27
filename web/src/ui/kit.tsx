import { useEffect, useRef, useState, type ChangeEvent, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Combobox } from './Combobox';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { rp } from '../format';

export function PageHead({ title, sub, crumb, children }: { title: string; sub?: ReactNode; crumb?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumb && <div className="crumb">{crumb}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="spacer" />
      {children}
    </div>
  );
}

export function Field({ label, hint, error, children, span }: { label?: string; hint?: ReactNode; error?: string; children: ReactNode; span?: boolean }) {
  return (
    <div className="field" style={span ? { gridColumn: '1 / -1' } : undefined}>
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="err-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`input ${p.className ?? ''}`} />;
}

// Dropdown dengan pilihan lebih dari ini otomatis bisa dicari (Combobox); yang pendek tetap dropdown biasa.
const SEARCHABLE_FROM = 8;

export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[]; placeholder?: string }) {
  if (options.length >= SEARCHABLE_FROM)
    return (
      <Combobox
        options={[...(placeholder !== undefined ? [{ value: '', label: placeholder }] : []), ...options.map((o) => ({ value: String(o.value), label: o.label }))]}
        value={String(p.value ?? '')}
        // meniru event <select> agar pemanggil tetap memakai e.target.value
        onChange={(v) => p.onChange?.({ target: { value: v }, currentTarget: { value: v } } as unknown as ChangeEvent<HTMLSelectElement>)}
        placeholder={placeholder}
        disabled={p.disabled}
        className={p.className}
        style={p.style}
      />
    );
  return (
    <select {...p} className={`select ${p.className ?? ''}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// Nominal: tampil "1.250.000" saat diketik, nilai yang dikirim tetap angka biasa ("1250000", desimal pakai titik).
export function formatAmount(raw: unknown) {
  const s = raw === null || raw === undefined ? '' : String(raw);
  if (s === '') return '';
  const [int, dec] = s.split('.');
  const grouped = (int ?? '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec !== undefined ? `${grouped || '0'},${dec}` : grouped;
}
export function parseAmount(text: string) {
  const t = text.replace(/[^\d,]/g, '');
  const [int, ...rest] = t.split(',');
  if (!rest.length) return int ?? '';
  return `${int || '0'}.${rest.join('').slice(0, 4)}`;
}

function AmountInput({ value, onChange, placeholder, ...p }: { value: any; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const ph = placeholder && /^\d+(\.\d+)?$/.test(String(placeholder)) ? formatAmount(placeholder) : placeholder;
  return <input {...p} placeholder={ph} className={`input num ${p.className ?? ''}`} inputMode="decimal" value={formatAmount(value)} onChange={(e) => onChange(parseAmount(e.target.value))} />;
}

export function Money({ value, onChange, ...p }: { value: any; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="input-affix">
      <span>Rp</span>
      <AmountInput {...p} value={value} onChange={onChange} />
    </div>
  );
}

// Jumlah barang: boleh desimal (0,5 / 1,25 kg). Koma maupun titik diterima sebagai desimal; nilai yang dikirim pakai titik.
export function parseQty(text: string) {
  const t = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const [int, ...rest] = t.split('.');
  if (!rest.length) return (int ?? '').replace(/^0+(?=\d)/, '');
  return `${(int ?? '').replace(/^0+(?=\d)/, '') || '0'}.${rest.join('').slice(0, 3)}`;
}
const formatQty = (raw: unknown) => (raw === null || raw === undefined ? '' : String(raw).replace('.', ','));

// Harga di bawah Rp1.000 biasanya salah ketik (17 maksudnya 17.000): tawarkan perbaikan sekali klik
export function ThousandHint({ value, onFix }: { value: unknown; onFix: (v: string) => void }) {
  const n = Number(value);
  if (!(n > 0 && n < 1000)) return null;
  return (
    <span className="thousand-hint">
      {rp(n)} — maksudnya <button type="button" className="link" onClick={() => onFix(String(Math.round(n * 1000)))}>{rp(n * 1000)}</button>?
    </span>
  );
}

export function Suffix({ value, onChange, suffix, ...p }: { value: any; onChange: (v: string) => void; suffix: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  // satuan Rp memakai pemisah ribuan; persen/jumlah tetap angka biasa (desimal pakai koma)
  return (
    <div className="input-affix suffix">
      {suffix === 'Rp'
        ? <AmountInput {...p} value={value} onChange={onChange} />
        : <input {...p} className={`input num ${p.className ?? ''}`} inputMode="decimal" placeholder={p.placeholder ?? '0'} value={formatQty(value)} onChange={(e) => onChange(parseQty(e.target.value))} />}
      <span>{suffix}</span>
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function SettingRow({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="txt">
        <b>{title}</b>
        {desc && <small>{desc}</small>}
      </div>
      {children}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Cari…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => v !== value && onChange(v), 250);
    return () => clearTimeout(t);
  }, [v]);
  return (
    <div className="search">
      <Search size={15} />
      <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} />
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.value} className={t.value === value ? 'on' : ''} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ tone, children, plain }: { tone?: 'green' | 'red' | 'amber' | 'blue' | 'accent'; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${tone ?? ''} ${plain ? 'plain' : ''}`}>{children}</span>;
}

type Tone = 'green' | 'red' | 'amber' | 'blue';

// Tombol filter per tahap dokumen; warna mengikuti status (kuning menunggu, merah ditolak, hijau selesai).
export function StageFilter<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; tone?: Tone; count?: number }[];
}) {
  return (
    <div className="stages">
      {options.map((o) => (
        <button key={o.value} type="button" className={`stage ${o.tone ?? ''} ${o.value === value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}{o.count ? <span className="n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// Kartu ringkas satu dokumen (PO, belanja). progress = persen diterima, tampil sebagai bar.
export function DocCard({ tone, number, status, title, meta, total, progress, note, onClick }: {
  tone?: Tone; number: string; status: ReactNode; title: ReactNode; meta: ReactNode[]; total: string;
  progress?: number | null; note?: ReactNode; onClick: () => void;
}) {
  return (
    <button type="button" className={`doc-card ${tone ?? ''}`} onClick={onClick}>
      <div className="doc-top"><span className="mono">{number}</span>{status}</div>
      <div className="doc-title">{title}</div>
      <div className="doc-meta">{meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}</div>
      {progress != null && (
        <div className="doc-progress">
          <div className="bar"><i style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>
          <span className="tnum">{progress}% diterima</span>
        </div>
      )}
      {note && <div className="doc-note">{note}</div>}
      <div className="doc-total num">{total}</div>
    </button>
  );
}

export function DocGrid({ children }: { children: ReactNode }) {
  return <div className="doc-grid">{children}</div>;
}

export function Sheet({ title, onClose, children, footer, wide, sub }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className={`sheet ${wide ? 'wide' : ''}`} role="dialog">
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{sub}</div>}
          </div>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Tutup"><X size={17} /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </aside>
    </>
  );
}

export function Confirm({ title, text, confirmText = 'Hapus', danger = true, onConfirm, onClose, busy }: {
  title: string; text: ReactNode; confirmText?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean;
}) {
  return (
    <>
      <div className="scrim top" onClick={onClose} />
      <div className="dialog" role="alertdialog">
        <div className="body">
          <h3>{title}</h3>
          <p>{text}</p>
        </div>
        <div className="foot">
          <button className="btn" onClick={onClose}>Batal</button>
          <button className={`btn ${danger ? 'dark' : 'primary'}`} onClick={onConfirm} disabled={busy}>{confirmText}</button>
        </div>
      </div>
    </>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="loading">Memuat…</div>;
}

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  return (
    <div className="pager">
      <span className="num">{(page - 1) * size + 1}–{Math.min(page * size, total)} dari {total}</span>
      <div className="spacer" />
      <button className="btn sm icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Sebelumnya"><ChevronLeft size={15} /></button>
      <span className="num">{page} / {pages}</span>
      <button className="btn sm icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Berikutnya"><ChevronRight size={15} /></button>
    </div>
  );
}

export function Popover({ trigger, children, align = 'right' }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="pop-anchor" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && <div className={`pop ${align === 'left' ? 'left' : ''}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="d">— vs periode lalu</span>;
  const ch = (cur - prev) / Math.abs(prev);
  const good = invert ? ch < 0 : ch > 0;
  return (
    <span className="d">
      <span className={ch === 0 ? '' : good ? 'up' : 'down'}>{ch > 0 ? '↑' : ch < 0 ? '↓' : ''} {Math.abs(ch * 100).toFixed(1)}%</span> vs periode lalu
    </span>
  );
}
