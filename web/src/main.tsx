import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from './ui/toast';
import './styles.css';

// data gagal dimuat (mis. galat server): beri tahu lewat toast agar halaman tidak tampak memuat tanpa akhir
const qc = new QueryClient({
  queryCache: new QueryCache({
    onError: (e: any) => {
      if (e?.status !== 401) window.dispatchEvent(new CustomEvent('momo:load-error', { detail: e?.message ?? 'Gagal memuat data' }));
    },
  }),
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: (n, e: any) => n < 1 && e?.status !== 401 && e?.status !== 403 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
