import { Suspense, useMemo } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Toaster } from 'sonner';
import {
  Activity,
  Calculator as CalculatorIcon,
  Eye,
  EyeOff,
  HandCoins,
  House,
  Landmark,
  LockKeyhole,
  LockKeyholeOpen,
  Moon,
  Plus,
  Sun,
  Target,
} from 'lucide-react';
import { useSettings, useSummary } from '../hooks/queries';
import { useHotkeys } from '../hooks/useHotkeys';
import { useAuth } from '../context/AuthContext';
import { usePalette, useUI } from '../context/UIContext';
import { BRAND } from '../lib/constants';
import { moneyWhole } from '../lib/format';
import { LoadingBlock } from './ui';
import TransactionModal from './TransactionForm';
import Calculator from './Calculator';
import NotificationCenter from './NotificationCenter';
import SettingsModal from './SettingsModal';

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true, key: 'h' },
  { to: '/transactions', label: 'Activity', icon: Activity, key: 'a' },
  { to: '/accounts', label: 'Accounts', icon: Landmark, key: 'w' },
  { to: '/splits', label: 'Collect', icon: HandCoins, key: 'p' },
  { to: '/budget', label: 'Budget', icon: Target, key: 'b' },
];

function ThemeToggle() {
  const { theme, toggleTheme } = useUI();
  const light = theme === 'light';
  return (
    <button className="btn-icon hidden overflow-hidden sm:inline-flex" onClick={toggleTheme} title={`Switch to ${light ? 'dark' : 'light'} mode (T)`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ y: 14, rotate: -90, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          exit={{ y: -14, rotate: 90, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {light ? <Moon size={18} /> : <Sun size={18} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Logo() {
  const palette = usePalette();
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.02]">
        <svg viewBox="0 0 64 64" className="h-6 w-6">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={palette.neon} />
              <stop offset="1" stopColor={palette.aqua} />
            </linearGradient>
          </defs>
          <path d="M18 14h13c11 0 19 8 19 18s-8 18-19 18H18z" fill="none" stroke="url(#lg)" strokeWidth="7" strokeLinejoin="round" />
          <circle cx="31" cy="32" r="5.5" fill={palette.neon} />
        </svg>
      </div>
      <div className="leading-tight">
        <p className="font-display text-lg font-bold tracking-tight text-white">
          Dhan<span className="text-gradient">Flow</span>
        </p>
        <p className="hidden text-[11px] text-white/40 sm:block">{BRAND.tagline}</p>
      </div>
    </div>
  );
}

function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="animate-drift absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full bg-neon/[0.07] blur-[120px]" />
      <div className="animate-drift-slow absolute top-1/4 -right-40 h-[560px] w-[560px] rounded-full bg-orchid/[0.10] blur-[130px]" />
      <div className="animate-drift absolute -bottom-48 left-1/3 h-[480px] w-[480px] rounded-full bg-aqua/[0.08] blur-[120px]" />
      <div className="grid-overlay absolute inset-0" />
    </div>
  );
}

function Dock({ onAdd }) {
  return (
    <nav className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="glass-solid flex items-center gap-0.5 rounded-[28px] p-2 sm:gap-1">
        {NAV.slice(0, 2).map((item) => (
          <DockLink key={item.to} {...item} />
        ))}
        <motion.button
          whileHover={{ scale: 1.08, rotate: 90 }}
          whileTap={{ scale: 0.92 }}
          onClick={onAdd}
          title="New transaction (N)"
          className="mx-1 flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl bg-neon text-black shadow-[0_0_28px_-4px_rgba(198,255,61,0.7)]"
        >
          <Plus size={22} strokeWidth={2.5} />
        </motion.button>
        {NAV.slice(2).map((item) => (
          <DockLink key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}

function DockLink({ to, label, icon: Icon, end }) {
  return (
    <NavLink to={to} end={end} className="group relative">
      {({ isActive }) => (
        <motion.div
          whileHover={{ y: -3 }}
          className={`relative flex h-12 min-w-11 items-center justify-center gap-2 rounded-2xl px-2.5 transition sm:min-w-12 sm:px-3 ${
            isActive ? 'text-ink' : 'text-white/55 hover:text-white'
          }`}
        >
          {isActive && (
            <motion.span
              layoutId="dock-active"
              className="absolute inset-0 rounded-2xl bg-white"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <Icon size={19} className="relative" />
          <span className={`relative text-sm font-semibold ${isActive ? 'hidden sm:inline' : 'hidden'}`}>{label}</span>
        </motion.div>
      )}
    </NavLink>
  );
}

function LockButton() {
  const { configured, lockNow } = useAuth();
  const { setSettingsOpen } = useUI();
  return (
    <button
      className={`btn-icon ${configured ? '' : 'text-amber-300/80'}`}
      onClick={configured ? lockNow : () => setSettingsOpen('lock-setup')}
      title={configured ? 'Lock now (L)' : 'Set up app lock (pattern or PIN)'}
    >
      {configured ? <LockKeyhole size={18} /> : <LockKeyholeOpen size={18} />}
    </button>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const { data: summary } = useSummary({});
  const { data: settings } = useSettings();
  const { openTransaction, toggleCalculator, setSettingsOpen, theme, toggleTheme, amountsHidden, toggleAmounts } = useUI();
  const { configured, lockNow } = useAuth();
  const name = settings?.name ?? BRAND.owner;

  const hotkeys = useMemo(
    () => ({
      n: () => openTransaction(),
      c: toggleCalculator,
      t: toggleTheme,
      m: toggleAmounts,
      ...(configured ? { l: lockNow } : {}),
      ...Object.fromEntries(NAV.map((n) => [n.key, () => navigate(n.to)])),
    }),
    [openTransaction, toggleCalculator, toggleTheme, toggleAmounts, configured, lockNow, navigate],
  );
  useHotkeys(hotkeys);

  return (
    <div className="relative min-h-screen">
      <Background />

      <header className="sticky top-0 z-30 border-b border-white/[0.05] bg-ink/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1.5">
            {summary && (
              <Link
                to="/accounts"
                title="See balance per account"
                className="mr-2 hidden items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2 transition hover:border-white/20 md:flex"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neon" />
                <span className="text-xs text-white/45">Balance</span>
                <span className={`num text-sm font-semibold ${summary.balance < 0 ? 'text-rose-300' : 'text-white'}`}>
                  {moneyWhole(summary.balance)}
                </span>
              </Link>
            )}
            <button
              className={`btn-icon ${amountsHidden ? 'text-neon' : ''}`}
              onClick={toggleAmounts}
              title={`${amountsHidden ? 'Show' : 'Hide'} amounts (M)`}
              aria-pressed={amountsHidden}
            >
              {amountsHidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <ThemeToggle />
            <LockButton />
            <button className="btn-icon" onClick={toggleCalculator} title="Calculator (C)">
              <CalculatorIcon size={18} />
            </button>
            <NotificationCenter />
            <button
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              className="ml-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl bg-gradient-to-br from-neon to-aqua font-display text-sm font-bold text-black transition hover:scale-105"
            >
              {name.charAt(0).toUpperCase()}
            </button>
          </div>
        </div>
      </header>

      {/* Remount pages when amounts are hidden/shown so memoised figures re-format. */}
      <main key={amountsHidden ? 'hidden' : 'shown'} className="mx-auto max-w-7xl px-4 pt-8 pb-32 sm:px-6">
        <Suspense fallback={<LoadingBlock />}>
          <Outlet />
        </Suspense>
      </main>

      <Dock onAdd={() => openTransaction()} />
      <Calculator />
      <TransactionModal />
      <SettingsModal />
      <Toaster position="top-center" theme={theme} richColors toastOptions={{ style: { borderRadius: 16 } }} />
    </div>
  );
}
