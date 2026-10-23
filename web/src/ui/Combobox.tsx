import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

// disabled: alasan pilihan tidak bisa dipilih — ditampilkan saat diklik.
export type ComboOption = { value: string; label: string; group?: string; hint?: string; disabled?: string };

// Pilihan yang bisa dicari: ketik untuk menyaring, panah atas/bawah + Enter untuk memilih.
export function Combobox({ options, value, onChange, placeholder = '— Pilih —', searchPlaceholder = 'Ketik untuk mencari…', disabled, className, style }: {
  options: ComboOption[]; value: string; onChange: (v: string) => void; placeholder?: string; searchPlaceholder?: string;
  disabled?: boolean; className?: string; style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState(0);
  const [why, setWhy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) => words.every((w) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(w)));
  }, [options, term]);

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setWhy(null);
    setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEffect(() => { setCursor(0); setWhy(null); }, [term]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  // Daftar pilihan dirender di lapisan atas (portal, position: fixed) supaya tidak terpotong oleh tabel/panel yang bisa di-scroll.
  // Membuka ke atas bila ruang di bawah tidak cukup; ikut bergeser saat halaman/panel di-scroll atau ukuran layar berubah.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 4, margin = 8, want = 320;
      const below = window.innerHeight - r.bottom - gap - margin, above = r.top - gap - margin;
      const up = below < Math.min(want, 200) && above > below;
      const width = Math.max(r.width, 240);
      const left = Math.min(Math.max(margin, r.left), window.innerWidth - width - margin);
      setPos(up
        ? { left, width, bottom: window.innerHeight - r.top + gap, maxHeight: Math.min(want, above) }
        : { left, width, top: r.bottom + gap, maxHeight: Math.min(want, below) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  const choose = (o: ComboOption) => {
    if (o.disabled) { setWhy(o.value); return; }
    onChange(o.value); setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(filtered.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[cursor]) choose(filtered[cursor]!); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  let lastGroup: string | undefined;
  return (
    <div className={`combo ${className ?? ''}`} style={style} ref={box}>
      <button type="button" disabled={disabled} className={`select combo-trigger ${selected && selected.value !== '' ? '' : 'placeholder'}`} onClick={() => setOpen((o) => !o)}>
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className="muted" />
      </button>
      {open && pos && createPortal(
        <div className="combo-pop" ref={pop} style={pos}>
          <div className="combo-search">
            <Search size={14} className="muted" />
            <input autoFocus value={term} placeholder={searchPlaceholder} onChange={(e) => setTerm(e.target.value)} onKeyDown={onKey} />
          </div>
          <div className="combo-list" ref={list}>
            {!filtered.length && <div className="combo-empty">Tidak ditemukan</div>}
            {filtered.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value}>
                  {head && <div className="combo-group">{head}</div>}
                  <button type="button" data-i={i} className={`combo-item ${i === cursor ? 'cur' : ''} ${o.value === value ? 'on' : ''} ${o.disabled ? 'off' : ''}`} aria-disabled={!!o.disabled}
                    onMouseEnter={() => setCursor(i)} onClick={() => choose(o)}>
                    <span>{o.label}</span>{o.hint && <span className="muted">{o.hint}</span>}
                  </button>
                  {why === o.value && <div className="combo-why">{o.disabled}</div>}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
