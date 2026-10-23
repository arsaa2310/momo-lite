const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });

export const rp = (v: unknown) => {
  const n = Math.round(Number(v) || 0);
  return `${n < 0 ? '−' : ''}Rp${idr.format(Math.abs(n))}`;
};
export const rpShort = (v: unknown) => {
  const n = Number(v) || 0;
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}Rp${dec.format(+(a / 1e9).toFixed(1))} M`;
  if (a >= 1e6) return `${sign}Rp${dec.format(+(a / 1e6).toFixed(1))} jt`;
  if (a >= 1e3) return `${sign}Rp${dec.format(+(a / 1e3).toFixed(0))} rb`;
  return rp(n);
};
export const qty = (v: unknown) => dec.format(Number(v) || 0);
export const pct = (v: unknown, digits = 1) => `${dec.format(+((Number(v) || 0) * 100).toFixed(digits))}%`;

const TZ = 'Asia/Jakarta';
export const dateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const date = (v?: string | null) =>
  v ? new Date(v.length === 10 ? `${v}T00:00:00+07:00` : v).toLocaleDateString('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const time = (v?: string | null) =>
  v ? new Date(v).toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—';

// Tanggal hari ini (WIB) sebagai YYYY-MM-DD
export const todayStr = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

export const variantLabel = (item: string, variant?: string | null) => (variant ? `${item} — ${variant}` : item);
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
