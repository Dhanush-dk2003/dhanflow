import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, LOCKED_EVENT } from '../lib/api';
import { useUI } from './UIContext';
import { Spinner } from '../components/ui';

const LockScreen = lazy(() => import('../components/LockScreen'));

const AuthContext = createContext(null);
const AUTH_KEY = ['auth'];

// sessionStorage lives per tab: it survives a refresh but not a new tab, window or browser restart.
const TAB_KEY = 'dhanflow-tab-unlocked';
const tabUnlocked = {
  get: () => {
    try {
      return sessionStorage.getItem(TAB_KEY) === '1';
    } catch {
      return false;
    }
  },
  set: (on) => {
    try {
      if (on) sessionStorage.setItem(TAB_KEY, '1');
      else sessionStorage.removeItem(TAB_KEY);
    } catch {
      /* storage unavailable: every load counts as opening the app */
    }
  },
};

let firstStatusCheck = true;

/**
 * Opening DhanFlow (a tab that was never unlocked) always asks for the PIN, even if the
 * browser still holds a valid session. The session is revoked too, so the API is locked
 * as well, not just the screen. After that the app stays unlocked until you lock it.
 */
async function fetchStatus() {
  const status = await api.auth.status();
  const opening = firstStatusCheck && !tabUnlocked.get();
  firstStatusCheck = false;
  if (opening && status.configured && status.authenticated) {
    await api.auth.lock().catch(() => {});
    return { ...status, authenticated: false };
  }
  return status;
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

export function AuthGate({ children }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setAmountsHidden } = useUI();
  const { data: status, isPending } = useQuery({
    queryKey: AUTH_KEY,
    queryFn: fetchStatus,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  const patchStatus = useCallback(
    (patch) => queryClient.setQueryData(AUTH_KEY, (old) => ({ ...old, ...patch })),
    [queryClient],
  );
  const refreshStatus = useCallback(() => queryClient.invalidateQueries({ queryKey: AUTH_KEY }), [queryClient]);

  const configured = Boolean(status?.configured);
  const locked = configured && !status.authenticated;

  const lockNow = useCallback(() => {
    // Hide the data first; the server call only revokes the session.
    patchStatus({ authenticated: false });
    api.auth.lock().catch(() => {});
  }, [patchStatus]);

  // Any API call answered with 401 LOCKED (session ended elsewhere) locks the UI.
  useEffect(() => {
    const onLocked = () => {
      patchStatus({ configured: true, authenticated: false });
      refreshStatus();
    };
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(LOCKED_EVENT, onLocked);
  }, [patchStatus, refreshStatus]);

  useEffect(() => {
    if (status) tabUnlocked.set(!locked);
  }, [status, locked]);

  // Runs after the app has unmounted, so no mounted query refetches the data we drop.
  useEffect(() => {
    if (!locked) return;
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_KEY[0] });
    // Recharts keeps the last measured chart label (an amount) in a hidden span on <body>.
    document.getElementById('recharts_measurement_span')?.remove();
  }, [locked, queryClient]);

  const onUnlocked = useCallback(() => {
    // Unlocking always starts on Home with amounts hidden; tap the eye to reveal them.
    setAmountsHidden(true);
    navigate('/', { replace: true });
    patchStatus({ authenticated: true, retryAfter: undefined });
  }, [setAmountsHidden, navigate, patchStatus]);

  const value = useMemo(
    () => ({ status, configured, lockNow, patchStatus, refreshStatus }),
    [status, configured, lockNow, patchStatus, refreshStatus],
  );

  let content = children;
  if (isPending) content = <Splash />;
  else if (locked) {
    content = (
      <Suspense fallback={<Splash />}>
        <LockScreen status={status} onUnlocked={onUnlocked} />
      </Suspense>
    );
  }

  return <AuthContext.Provider value={value}>{content}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthGate');
  return ctx;
};
