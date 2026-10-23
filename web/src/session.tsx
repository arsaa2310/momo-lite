import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type Role = 'superadmin' | 'central' | 'purchasing';
export type Me = {
  user: { id: number; name: string; email: string; role: Role; role_label: string };
  resto: { id: number; name: string; code: string; address: string | null; phone: string | null } | null;
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
  return { ...c, role: c.user.role, isCentral: c.user.role === 'central' };
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/auth/logout');
    qc.clear();
    window.location.href = '/login';
  };
}
