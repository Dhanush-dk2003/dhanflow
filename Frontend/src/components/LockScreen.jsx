import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LockKeyhole, Timer } from 'lucide-react';
import { api } from '../lib/api';
import { BRAND } from '../lib/constants';
import { usePalette } from '../context/UIContext';
import { PatternPad, PinPad } from './LockPads';
import { Spinner } from './ui';

function useCountdown(initialSeconds) {
  const [until, setUntil] = useState(() => (initialSeconds ? Date.now() + initialSeconds * 1000 : 0));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [until]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return [left, (seconds) => { setNow(Date.now()); setUntil(Date.now() + seconds * 1000); }];
}

const THROTTLED_MESSAGE = 'Too many wrong tries.';
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function LockScreen({ status, onUnlocked }) {
  const palette = usePalette();
  const isPattern = status.method === 'pattern';
  const [tone, setTone] = useState('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [padKey, setPadKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [waitLeft, startWait] = useCountdown(status.retryAfter);
  const throttled = waitLeft > 0;

  useEffect(() => {
    if (!throttled) setMessage((m) => (m === THROTTLED_MESSAGE ? '' : m));
  }, [throttled]);

  const resetPad = (delay) => setTimeout(() => {
    setTone('idle');
    setPadKey((k) => k + 1);
  }, delay);

  const submit = async (secret) => {
    if (busy || throttled) return;
    setBusy(true);
    try {
      await api.auth.unlock(secret);
      setTone('success');
      setMessage('');
      setTimeout(onUnlocked, 220);
    } catch (err) {
      setTone('error');
      if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
      if (err.data?.code === 'THROTTLED') {
        startWait(err.data.retryAfter);
        setMessage(THROTTLED_MESSAGE);
      } else {
        setMessage(err.message);
      }
      resetPad(800);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-drift absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full bg-neon/[0.07] blur-[120px]" />
        <div className="animate-drift-slow absolute -right-40 bottom-0 h-[560px] w-[560px] rounded-full bg-orchid/[0.10] blur-[130px]" />
        <div className="grid-overlay absolute inset-0" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="glass w-full max-w-sm px-6 py-8 text-center"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.02]">
          <svg viewBox="0 0 64 64" className="h-7 w-7">
            <defs>
              <linearGradient id="lock-lg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={palette.neon} />
                <stop offset="1" stopColor={palette.aqua} />
              </linearGradient>
            </defs>
            <path d="M18 14h13c11 0 19 8 19 18s-8 18-19 18H18z" fill="none" stroke="url(#lock-lg)" strokeWidth="7" strokeLinejoin="round" />
            <circle cx="31" cy="32" r="5.5" fill={palette.neon} />
          </svg>
        </div>
        <p className="eyebrow flex items-center justify-center gap-1.5">
          <LockKeyhole size={12} /> {BRAND.name} is locked
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-white">Welcome back, {status.name || BRAND.owner}</h1>
        <p className="mt-1 text-sm text-white/45">{isPattern ? 'Draw your pattern to unlock' : 'Enter your PIN to unlock'}</p>

        <div className="mt-7">
          {isPattern ? (
            <PatternPad key={padKey} onComplete={submit} tone={tone} disabled={busy || throttled} />
          ) : (
            <PinPad key={padKey} onSubmit={submit} tone={tone} disabled={busy || throttled} />
          )}
        </div>

        <div className="mt-5 min-h-10 text-sm" aria-live="polite">
          {busy ? (
            <Spinner />
          ) : throttled ? (
            <p className="flex items-center justify-center gap-1.5 text-amber-300">
              <Timer size={15} /> {THROTTLED_MESSAGE} Try again in <span className="num font-semibold">{clock(waitLeft)}</span>
            </p>
          ) : (
            message && <p className="text-rose-300">{message}</p>
          )}
        </div>

        <button type="button" className="mt-2 text-xs text-white/35 underline-offset-4 hover:text-white/60 hover:underline" onClick={() => setShowHelp((s) => !s)}>
          Forgot your {isPattern ? 'pattern' : 'PIN'}?
        </button>
        {showHelp && (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-xs leading-relaxed text-white/55">
            On the computer running DhanFlow, open the <span className="font-mono text-white/75">Backend</span> folder and run{' '}
            <span className="font-mono text-neon">npm run reset-lock</span>. That removes the lock only; your money data stays as it is.
          </p>
        )}
      </motion.div>
    </div>
  );
}
