import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { UIProvider } from './context/UIContext';
import { AuthGate } from './context/AuthContext';
import { ConfirmProvider } from './components/ConfirmDialog';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failures, err) => err?.status !== 401 && failures < 1,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <UIProvider>
          <AuthGate>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </AuthGate>
        </UIProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
