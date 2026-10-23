import { useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import { api } from '../api';

// Kompres gambar di browser sebelum diunggah: sisi terpanjang dibatasi & disimpan sebagai JPEG.
// Kualitas dijaga cukup tinggi agar teks (mis. struk / nota) tetap terbaca.
export async function compressImage(file: File, maxSide = 1600, quality = 0.86): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error('Gambar tidak bisa dibaca'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // latar putih untuk PNG transparan
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type Kind = 'receiving' | 'expense' | 'payment';
export type Photo = { id: number; url: string };

export async function uploadImage(file: File, kind: Kind) {
  const data = await compressImage(file);
  return api.post<{ id: number; url: string; size: number }>('/uploads', { data, kind });
}

export const photoUrl = (id: number) => `/api/uploads/${id}`;

// Foto bukti wajib (barang / nota): bisa langsung dari kamera di HP.
export function PhotoInput({ label, value, onChange, kind }: { label: string; value: Photo | null; onChange: (v: Photo | null) => void; kind: Kind }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    setErr('');
    try {
      const r = await uploadImage(f, kind);
      onChange({ id: r.id, url: r.url });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="photo-input">
      <div className="photo-label">{label}</div>
      {value ? (
        <div className="photo-preview">
          <a href={value.url} target="_blank" rel="noreferrer"><img src={value.url} alt={label} /></a>
          <button type="button" className="btn ghost icon" aria-label="Hapus foto" onClick={() => onChange(null)}><X size={15} /></button>
        </div>
      ) : (
        <button type="button" className="photo-drop" disabled={busy} onClick={() => input.current?.click()}>
          <Camera size={20} />
          <span>{busy ? 'Mengunggah…' : 'Ambil / pilih foto'}</span>
        </button>
      )}
      {err && <span className="err-text">{err}</span>}
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

// Foto tambahan (opsional, maks. 6)
export function ExtraPhotos({ value, onChange, kind, max = 6 }: { value: Photo[]; onChange: (v: Photo[]) => void; kind: Kind; max?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr('');
    try {
      const out = [...value];
      for (const f of [...files].slice(0, max - value.length)) {
        const r = await uploadImage(f, kind);
        out.push({ id: r.id, url: r.url });
      }
      onChange(out);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="photo-input">
      <div className="photo-label">Foto tambahan (opsional)</div>
      <div className="photo-strip">
        {value.map((p) => (
          <div key={p.id} className="photo-thumb">
            <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="" /></a>
            <button type="button" className="x" aria-label="Hapus" onClick={() => onChange(value.filter((x) => x.id !== p.id))}><X size={13} /></button>
          </div>
        ))}
        {value.length < max && (
          <button type="button" className="photo-add" disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlus size={18} /> {busy ? 'Mengunggah…' : 'Tambah'}
          </button>
        )}
      </div>
      {err && <span className="err-text">{err}</span>}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}

// Foto tersimpan: klik untuk membuka ukuran penuh
export function PhotoStrip({ photos }: { photos: { id?: number | null; label: string }[] }) {
  const list = photos.filter((p) => p.id);
  if (!list.length) return null;
  return (
    <div className="photo-strip">
      {list.map((p, i) => (
        <a key={`${p.id}-${i}`} className="photo-thumb" href={photoUrl(p.id!)} target="_blank" rel="noreferrer" title={p.label}>
          <img src={photoUrl(p.id!)} alt={p.label} loading="lazy" />
          <span>{p.label}</span>
        </a>
      ))}
    </div>
  );
}
