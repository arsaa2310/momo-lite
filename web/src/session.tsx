import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type Role = 'superadmin' | 'owner' | 'central' | 'manager' | 'purchasing';
export type Me = {
  user: { id: number; name: string; email: string; role: Role; role_label: string };
  resto: { id: number; name: string; code: string; address: string | null; phone: string | null; shift_names: string[] } | null;
  restos: { id: number; name: string; code: string }[]; // Owner: resto yang bisa dipilih
};

const SessionCtx = createContext<Me | null>(null);

export function useSessionQuery() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), retry: false, staleTime: 60_000 });
}

export function SessionProvider({ data, children }: { data: Me; children: ReactNode }) {
  return <SessionCtx.Provider value={data}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('SessionProvider missing');
  const role = c.user.role;
  // isAdmin: Central Admin / Owner — K/T, pelunasan, pembatalan, master data, menyetujui pengeluaran lain
  return { ...c, role, isAdmin: role === 'central' || role === 'owner', isOwner: role === 'owner', isManager: role === 'manager',
    canApprovePo: role === 'manager' || role === 'owner' };
}

// Owner berpindah resto: semua data dimuat ulang untuk resto baru
export function useSwitchResto() {
  const qc = useQueryClient();
  return async (id: number) => {
    await api.post('/auth/resto', { resto_id: id });
    qc.clear();
    await qc.invalidateQueries();
  };
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/auth/logout');
    qc.clear();
    window.location.href = '/login';
  };
}
