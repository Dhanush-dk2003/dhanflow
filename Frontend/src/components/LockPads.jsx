import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Delete } from 'lucide-react';
import { usePalette } from '../context/UIContext';

export const MIN_PATTERN_DOTS = 4;
export const PIN_MIN = 4;
export const PIN_MAX = 8;

const SIZE = 270;
const CELL = SIZE / 3;
const HIT_RADIUS = CELL * 0.32;
const DOTS = Array.from({ length: 9 }, (_, i) => ({ x: (i % 3 + 0.5) * CELL, y: (Math.floor(i / 3) + 0.5) * CELL }));

const shake = { x: [0, -12, 12, -8, 8, -4, 4, 0], transition: { duration: 0.45 } };

// Like Android: dragging from a dot to the one two steps away also picks the dot in between.
function between(a, b) {
  const [ra, ca, rb, cb] = [Math.floor(a / 3), a % 3, Math.floor(b / 3), b % 3];
  if ((ra + rb) % 2 || (ca + cb) % 2) return -1;
  return ((ra + rb) / 2) * 3 + (ca + cb) / 2;
}

/**
 * 3×3 pattern grid. Reports the dot sequence (e.g. "0,1,2,5") on release.
 * `tone` colours the drawn path: 'idle' | 'error' | 'success'. Remount (change `key`) to clear.
 */
export function PatternPad({ onComplete, tone = 'idle', disabled = false }) {
  const palette = usePalette();
  const svgRef = useRef(null);
  const pathRef = useRef([]);
  const [path, setPath] = useState([]);
  const [pointer, setPointer] = useState(null);
  const [drawing, setDrawing] = useState(false);

  const color = tone === 'error' ? palette.rose : tone === 'success' ? palette.aqua : palette.neon;

  const toLocal = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * SIZE) / r.width, y: ((e.clientY - r.top) * SIZE) / r.height };
  };

  const visit = (p) => {
    const i = DOTS.findIndex((d) => Math.hypot(d.x - p.x, d.y - p.y) < HIT_RADIUS);
    const current = pathRef.current;
    if (i < 0 || current.includes(i)) return;
    const next = [...current];
    const last = next.at(-1);
    if (last !== undefined) {
      const mid = between(last, i);
      if (mid >= 0 && !next.includes(mid)) next.push(mid);
    }
    next.push(i);
    if (navigator.vibrate) navigator.vibrate(8);
    pathRef.current = next;
    setPath(next);
  };

  const onPointerDown = (e) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pathRef.current = [];
    setPath([]);
    setDrawing(true);
    const p = toLocal(e);
    setPointer(p);
    visit(p);
  };

  const onPointerMove = (e) => {
    if (!drawing) return;
    const p = toLocal(e);
    setPointer(p);
    visit(p);
  };

  const onPointerUp = () => {
    if (!drawing) return;
    setDrawing(false);
    setPointer(null);
    if (pathRef.current.length) onComplete(pathRef.current.join(','));
  };

  const points = path.map((i) => `${DOTS[i].x},${DOTS[i].y}`);
  if (drawing && pointer && path.length) points.push(`${pointer.x},${pointer.y}`);

  return (
    <motion.svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={`mx-auto w-full max-w-[270px] touch-none select-none ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
      animate={tone === 'error' ? shake : { x: 0 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label="Pattern grid: drag across the dots to draw your pattern"
    >
      {points.length > 1 && (
        <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      )}
      {DOTS.map((d, i) => {
        const on = path.includes(i);
        return (
          <g key={i}>
            <circle cx={d.x} cy={d.y} r={on ? 24 : 0} fill={color} opacity="0.14" style={{ transition: 'r 0.18s' }} />
            <circle cx={d.x} cy={d.y} r={on ? 9 : 6} fill={on ? color : palette.axis} style={{ transition: 'r 0.15s' }} />
          </g>
        );
      })}
    </motion.svg>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];

/** Numeric keypad with dot display. Works with the physical keyboard too (digits, Backspace, Enter). */
export function PinPad({ onSubmit, tone = 'idle', disabled = false, submitLabel = 'Unlock' }) {
  const [pin, setPin] = useState('');

  const press = useCallback(
    (key) => {
      if (disabled) return;
      if (key === 'del') setPin((p) => p.slice(0, -1));
      else if (key === 'ok') {
        if (pin.length >= PIN_MIN) onSubmit(pin);
      } else setPin((p) => (p.length < PIN_MAX ? p + key : p));
    },
    [disabled, pin, onSubmit],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const dotColor = tone === 'error' ? 'bg-rose-400' : tone === 'success' ? 'bg-aqua' : 'bg-neon';

  return (
    <div className={`mx-auto w-full max-w-[270px] ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      <motion.div className="mb-6 flex h-4 items-center justify-center gap-3" animate={tone === 'error' ? shake : { x: 0 }} aria-live="polite">
        {Array.from({ length: Math.max(PIN_MIN, pin.length) }, (_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full transition ${i < pin.length ? `${dotColor} scale-100` : 'scale-75 border border-white/25'}`}
          />
        ))}
        <span className="sr-only">{pin.length} digits entered</span>
      </motion.div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => {
          const ok = k === 'ok';
          return (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              disabled={ok && pin.length < PIN_MIN}
              aria-label={k === 'del' ? 'Delete digit' : ok ? submitLabel : k}
              className={`flex h-16 cursor-pointer items-center justify-center rounded-2xl font-display text-2xl font-medium transition active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 ${
                ok ? 'bg-neon text-black' : 'border border-white/10 bg-white/[0.04] text-white hover:bg-white/10'
              }`}
            >
              {k === 'del' ? <Delete size={22} /> : ok ? <Check size={24} strokeWidth={2.5} /> : k}
            </button>
          );
        })}
      </div>
    </div>
  );
}
