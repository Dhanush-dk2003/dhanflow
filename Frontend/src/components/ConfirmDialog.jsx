import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleHelp, LoaderCircle, TriangleAlert, Trash2 } from 'lucide-react';

const ConfirmContext = createContext(null);

const TONES = {
  danger: {
    icon: Trash2,
    badge: 'bg-rose-500/15 text-rose-300 ring-rose-400/25',
    button: 'bg-rose-500 text-[#fff] shadow-[0_0_24px_-6px_rgba(244,63,94,0.7)] hover:bg-rose-400',
  },
  warning: {
    icon: TriangleAlert,
    badge: 'bg-amber-500/15 text-amber-300 ring-amber-400/25',
    button: 'bg-amber-400 text-[#111] hover:bg-amber-300',
  },
  default: {
    icon: CircleHelp,
    badge: 'bg-neon/15 text-neon ring-neon/25',
    button: 'bg-neon text-black hover:brightness-110',
  },
};

function Dialog({ request, onClose }) {
  const { title, message, detail, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default', icon, action } = request.options;
  const style = TONES[tone] ?? TONES.default;
  const Icon = icon ?? style.icon;
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  const cancel = useCallback(() => !busy && onClose(false), [busy, onClose]);

  const confirm = async () => {
    if (!action) return onClose(true);
    setBusy(true);
    try {
      await action();
      onClose(true);
    } catch {
      // The action reports its own error (mutations toast); keep the dialog open to retry or cancel.
      setBusy(false);
    }
  };

  useEffect(() => {
    // Destructive actions start on Cancel so a stray Enter can't delete anything.
    (tone === 'danger' ? cancelRef : confirmRef).current?.focus();
  }, [tone]);

  useEffect(() => {
    // Capture phase on window runs before page hotkeys and any modal underneath, then stops them.
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') cancel();
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cancel]);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={cancel}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="glass-solid w-full max-w-sm p-6"
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ${style.badge}`}>
          <Icon size={22} />
        </div>
        <h2 id="confirm-title" className="font-display text-xl font-semibold text-white">{title}</h2>
        {message && (
          <div id="confirm-message" className="mt-1.5 text-sm leading-relaxed text-white/55">{message}</div>
        )}
        {detail && <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">{detail}</div>}

        <div className="mt-6 grid grid-cols-2 gap-2">
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={cancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={confirm}
            disabled={busy}
            className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 ${style.button}`}
          >
            {busy && <LoaderCircle size={16} className="animate-spin" />} {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * In-app replacement for window.confirm.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title, message, tone: 'danger', confirmLabel: 'Delete', action: () => remove.mutateAsync(id) })) …
 *
 * With `action`, the dialog stays open with a spinner until it settles and only closes on success.
 * Resolves `true` when confirmed, `false` when cancelled.
 */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        setRequest((prev) => {
          prev?.resolve(false);
          return { options, resolve, returnFocus: document.activeElement };
        });
      }),
    [],
  );

  const close = useCallback(
    (result) => {
      request?.resolve(result);
      request?.returnFocus?.focus?.();
      setRequest(null);
    },
    [request],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>{request && <Dialog key="confirm" request={request} onClose={close} />}</AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
};
