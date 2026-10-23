import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; err?: boolean };
const Ctx = createContext<(text: string, err?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, err?: boolean) => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, err }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), err ? 4500 : 2600);
  }, []);
  useEffect(() => {
    const on = (e: Event) => push(`Gagal memuat: ${(e as CustomEvent).detail}`, true);
    window.addEventListener('momo:load-error', on);
    return () => window.removeEventListener('momo:load-error', on);
  }, [push]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
