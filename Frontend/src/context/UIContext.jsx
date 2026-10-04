import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PALETTES } from '../lib/constants';
import { setAmountsHidden } from '../lib/format';

const UIContext = createContext(null);
const THEME_KEY = 'dhanflow-theme';
const PRIVACY_KEY = 'dhanflow-hide-amounts';

const readFlag = (key) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const writeFlag = (key, on) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* storage unavailable (private mode); the setting still applies for this session */
  }
};

export function UIProvider({ children }) {
  const [txnModal, setTxnModal] = useState({ open: false, transaction: null, prefill: null });
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  const [amountsHidden, setHidden] = useState(() => readFlag(PRIVACY_KEY));

  // Set during render (idempotent) so every formatter called by this render sees the new value.
  setAmountsHidden(amountsHidden);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f3f8' : '#07070b');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable (private mode); theme still applies for this session */
    }
  }, [theme]);

  useEffect(() => writeFlag(PRIVACY_KEY, amountsHidden), [amountsHidden]);

  const openTransaction = useCallback((transaction = null, prefill = null) => {
    setTxnModal({ open: true, transaction, prefill });
  }, []);
  const closeTransaction = useCallback(() => setTxnModal({ open: false, transaction: null, prefill: null }), []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);
  const toggleAmounts = useCallback(() => setHidden((h) => !h), []);

  const value = useMemo(
    () => ({
      txnModal,
      openTransaction,
      closeTransaction,
      calculatorOpen,
      setCalculatorOpen,
      toggleCalculator: () => setCalculatorOpen((o) => !o),
      settingsOpen,
      setSettingsOpen,
      theme,
      setTheme,
      toggleTheme,
      amountsHidden,
      setAmountsHidden: setHidden,
      toggleAmounts,
    }),
    [txnModal, openTransaction, closeTransaction, calculatorOpen, settingsOpen, theme, toggleTheme, amountsHidden, toggleAmounts],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export const useUI = () => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside UIProvider');
  return ctx;
};

/** Raw colour values for SVG/canvas (charts, gauges) that can't read CSS variables. */
export const usePalette = () => PALETTES[useUI().theme];
