import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Inbox, LoaderCircle, X } from 'lucide-react';
import { money } from '../lib/format';
import { usePalette } from '../context/UIContext';

export function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-xl text-sm text-white/50">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ className = '', children, delay = 0, ...rest }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`glass ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Counts up from the previous value whenever `value` changes. */
export function AnimatedNumber({ value = 0, format = money, duration = 900, className = '' }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) return;
    let frame;
    const start = performance.now();
    const tick = (now) => {
      // rAF timestamps can precede `start` by a frame, which would ease below the starting value.
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      const eased = 1 - (1 - t) ** 4;
      setDisplay(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = to;
    };
  }, [value, duration]);

  return <span className={`num ${className}`}>{format(display)}</span>;
}

export function StatTile({ label, value, hint, icon: Icon, accent = 'text-neon', delay = 0, format }) {
  return (
    <Card delay={delay} className="group relative overflow-hidden p-5 transition hover:border-white/15">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {Icon && (
          <div className={`rounded-xl bg-white/5 p-2 ${accent} transition group-hover:scale-110 group-hover:rotate-6`}>
            <Icon size={16} />
          </div>
        )}
      </div>
      <p className="mt-3 truncate text-2xl font-semibold text-white">
        <AnimatedNumber value={value} format={format} />
      </p>
      {hint && <p className="mt-1.5 text-xs text-white/40">{hint}</p>}
    </Card>
  );
}

export function RingGauge({ value = 0, max = 100, size = 120, stroke = 10, color: colorProp, track: trackProp, children }) {
  const palette = usePalette();
  const color = colorProp ?? palette.neon;
  const track = trackProp ?? palette.track;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function ProgressBar({ percent = 0, color, className = 'h-2' }) {
  const palette = usePalette();
  const pct = Math.max(0, Math.min(100, percent));
  const auto = percent > 100 ? palette.rose : percent >= 80 ? palette.amber : palette.neon;
  return (
    <div className={`overflow-hidden rounded-full bg-white/[0.06] ${className}`}>
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color ?? auto, boxShadow: `0 0 12px ${(color ?? auto)}66` }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

export function Segmented({ options, value, onChange, size = 'md' }) {
  return (
    <div className="relative flex gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`relative cursor-pointer rounded-xl font-medium whitespace-nowrap transition ${
            size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'
          } ${value === o.value ? 'text-black' : 'text-white/55 hover:text-white'}`}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${options.map((x) => x.value).join('')}`}
              className="absolute inset-0 rounded-xl bg-neon"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className = '' }) {
  return <LoaderCircle className={`animate-spin text-neon ${className}`} size={18} />;
}

export function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner />
    </div>
  );
}

export function EmptyState({ title, message, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/40">
        <Icon size={22} />
      </div>
      <p className="font-display text-lg font-medium text-white/85">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-white/45">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error }) {
  return (
    <div className="glass mb-6 border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-200">
      Could not load data: {error?.message}. Make sure the backend is running on port 5000.
    </div>
  );
}

export function Modal({ open, title, onClose, children, size = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="flex min-h-full items-center justify-center p-4" onClick={onClose}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className={`glass-solid relative w-full ${size}`}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 pt-5 pb-2">
                <h2 className="font-display text-xl font-semibold text-white">{title}</h2>
                <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="px-6 pt-2 pb-6">{children}</div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Avatar({ name, size = 'h-10 w-10' }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const hue = [...name.toLowerCase()].reduce((h, ch) => h + ch.charCodeAt(0) * 7, 0) % 360;
  return (
    <div
      className={`flex ${size} shrink-0 items-center justify-center rounded-2xl text-xs font-bold text-black`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 90% 70%), hsl(${(hue + 50) % 360} 85% 60%))` }}
    >
      {initials}
    </div>
  );
}

export function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-white/[0.06] text-white/60 border-white/10',
    emerald: 'bg-neon/10 text-neon border-neon/20',
    rose: 'bg-rose-500/10 text-rose-300 border-rose-400/20',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-400/20',
    aqua: 'bg-aqua/10 text-aqua border-aqua/20',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
