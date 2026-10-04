import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Copy, Delete, History, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useUI } from '../context/UIContext';
import { evaluate, tryEvaluate } from '../lib/calc';
import { moneyExact } from '../lib/format';

const KEYS = [
  ['C', '(', ')', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['%', '0', '.', '='],
];

const OPERATORS = new Set(['÷', '×', '-', '+', '%', '(', ')']);

export default function Calculator() {
  const { calculatorOpen, setCalculatorOpen, openTransaction } = useUI();
  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');

  const preview = tryEvaluate(expr);
  const result = preview ?? null;

  const commit = useCallback(() => {
    try {
      const value = evaluate(expr);
      if (value == null) return;
      setHistory((h) => [{ expr, value }, ...h].slice(0, 8));
      setExpr(String(value));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [expr]);

  const press = useCallback(
    (key) => {
      setError('');
      if (key === 'C') return setExpr('');
      if (key === '=') return commit();
      if (key === 'back') return setExpr((e) => e.slice(0, -1));
      setExpr((e) => e + key);
    },
    [commit],
  );

  useEffect(() => {
    if (!calculatorOpen) return;
    const onKey = (e) => {
      const el = document.activeElement;
      if (el?.closest?.('[role=dialog]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const map = { '*': '×', '/': '÷', Enter: '=', '=': '=', Backspace: 'back', Escape: 'close', Delete: 'C' };
      const key = map[e.key] ?? e.key;
      if (key === 'close') return setCalculatorOpen(false);
      if (/^[\d.]$/.test(key) || OPERATORS.has(key) || key === '=' || key === 'back' || key === 'C') {
        e.preventDefault();
        press(key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calculatorOpen, press, setCalculatorOpen]);

  const finalValue = result ?? (expr ? null : 0);

  const useAsExpense = () => {
    if (!(finalValue > 0)) return toast.error('Calculate a positive amount first');
    openTransaction(null, { amount: String(Math.round(finalValue * 100) / 100) });
    setCalculatorOpen(false);
  };

  const copy = async () => {
    if (finalValue == null) return;
    await navigator.clipboard.writeText(String(finalValue));
    toast.success('Copied to clipboard');
  };

  return (
    <AnimatePresence>
      {calculatorOpen && (
        <motion.div
          drag
          dragMomentum={false}
          initial={{ opacity: 0, y: 30, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="glass-solid fixed right-4 bottom-28 z-40 max-h-[calc(100dvh-8.5rem)] w-[300px] overflow-y-auto p-4 sm:right-6"
        >
          <div className="mb-3 flex cursor-grab items-center justify-between active:cursor-grabbing">
            <p className="eyebrow">Calculator · drag me</p>
            <div className="flex gap-0.5">
              <button className="btn-icon h-7 w-7" title="History" onClick={() => setShowHistory((s) => !s)}>
                <History size={14} />
              </button>
              <button className="btn-icon h-7 w-7" title="Close (Esc)" onClick={() => setCalculatorOpen(false)}>
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="mb-3 rounded-2xl border border-white/[0.06] bg-black/30 px-4 py-3 text-right">
            <p className="min-h-5 truncate font-mono text-sm text-white/45">{expr || '0'}</p>
            <p className={`num truncate text-3xl font-semibold ${error ? 'text-rose-300' : 'text-white'}`}>
              {error || (result != null ? result.toLocaleString('en-IN', { maximumFractionDigits: 8 }) : expr ? '…' : '0')}
            </p>
          </div>

          <AnimatePresence initial={false}>
            {showHistory && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-3 max-h-36 overflow-y-auto rounded-2xl border border-white/[0.06] bg-black/20"
              >
                {history.length ? (
                  history.map((h, i) => (
                    <li key={i}>
                      <button
                        className="flex w-full cursor-pointer justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-white/5"
                        onClick={() => setExpr(String(h.value))}
                      >
                        <span className="truncate font-mono text-white/40">{h.expr}</span>
                        <span className="num text-white/80">{h.value}</span>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="px-3 py-3 text-center text-xs text-white/35">No calculations yet</li>
                )}
              </motion.ul>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-4 gap-2">
            {KEYS.flat().map((key) => {
              const isOp = OPERATORS.has(key) && key !== '(' && key !== ')';
              const isEq = key === '=';
              return (
                <motion.button
                  key={key}
                  whileTap={{ scale: 0.88 }}
                  onClick={() => press(key)}
                  className={`h-11 cursor-pointer rounded-2xl text-lg font-semibold transition ${
                    isEq
                      ? 'bg-neon text-black shadow-[0_0_20px_-6px_rgba(198,255,61,0.8)]'
                      : isOp
                        ? 'bg-white/[0.08] text-neon hover:bg-white/[0.12]'
                        : key === 'C'
                          ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                          : 'bg-white/[0.04] text-white/85 hover:bg-white/[0.09]'
                  }`}
                >
                  {key}
                </motion.button>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-[auto_auto_1fr] gap-2">
            <button className="btn-icon h-10 w-10 bg-white/[0.04]" title="Backspace" onClick={() => press('back')}>
              <Delete size={16} />
            </button>
            <button className="btn-icon h-10 w-10 bg-white/[0.04]" title="Copy result" onClick={copy}>
              <Copy size={15} />
            </button>
            <button className="btn-primary h-10 px-3 py-0 text-xs" onClick={useAsExpense}>
              <Plus size={14} /> Add {finalValue > 0 ? moneyExact(finalValue) : 'as transaction'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
