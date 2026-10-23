import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useToast } from './toast';

// refetchInterval (ms): muat ulang berkala, mis. dashboard live
export function useApi<T = any>(url: string | null, opts: { keepPrevious?: boolean; refetchInterval?: number } = {}) {
  return useQuery<T>({
    queryKey: [url],
    queryFn: () => api.get<T>(url!),
    enabled: !!url,
    placeholderData: opts.keepPrevious ? (prev) => prev : undefined,
    refetchInterval: opts.refetchInterval,
  });
}

// Mutasi + toast + refresh semua query yang URL-nya diawali prefix tertentu.
// onError: kembalikan true bila galat sudah ditangani sendiri (tanpa toast).
export function useAction<V = any, R = any>(fn: (v: V) => Promise<R>, opts: { success?: string | ((r: R) => string); invalidate?: string[]; onDone?: (r: R) => void; onError?: (e: any) => boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      for (const p of opts.invalidate ?? [])
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(p) });
      qc.invalidateQueries({ queryKey: ['me'] });
      opts.onDone?.(r);
    },
    onError: (e: any) => { if (!opts.onError?.(e)) toast(e.message ?? 'Gagal menyimpan', true); },
  });
}

