import { useState } from 'react';
import { ArrowLeft, EyeOff, Grip, KeyRound, LockKeyhole, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { MIN_PATTERN_DOTS, PatternPad, PinPad } from './LockPads';
import { Segmented, Spinner } from './ui';

const methodName = (m) => (m === 'pattern' ? 'pattern' : 'PIN');

function Toggle({ title, hint, checked, onChange, icon: Icon }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium text-white">
          {Icon && <Icon size={15} className="text-aqua" />} {title}
        </p>
        <p className="text-xs text-white/45">{hint}</p>
      </div>
      <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#c6ff3d]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function SecretPad({ method, onDone, tone, disabled, submitLabel }) {
  return method === 'pattern' ? (
    <PatternPad onComplete={onDone} tone={tone} disabled={disabled} />
  ) : (
    <PinPad onSubmit={onDone} tone={tone} disabled={disabled} submitLabel={submitLabel} />
  );
}

/**
 * Guided flow to create, change or remove the lock.
 * Steps: [current secret] → choose + draw new → confirm → save.
 */
export function LockFlow({ mode, currentMethod, onClose }) {
  const { patchStatus } = useAuth();
  const [step, setStep] = useState(mode === 'create' ? 'choose' : 'current');
  const [method, setMethod] = useState(currentMethod ?? 'pattern');
  const [currentSecret, setCurrentSecret] = useState('');
  const [first, setFirst] = useState('');
  const [tone, setTone] = useState('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [padKey, setPadKey] = useState(0);

  const goto = (next, message = '', error = false) => {
    setTone(error ? 'error' : 'idle');
    setNote(message);
    setTimeout(
      () => {
        setTone('idle');
        setStep(next);
        setPadKey((k) => k + 1);
      },
      error ? 700 : 0,
    );
  };

  const failCurrent = (err) => {
    const code = err.data?.code;
    if (code === 'BAD_SECRET' || code === 'THROTTLED') goto('current', err.message, true);
    else toast.error(err.message);
  };

  const onCurrent = async (secret) => {
    if (mode === 'remove') {
      setBusy(true);
      try {
        await api.auth.remove(secret);
        patchStatus({ configured: false, authenticated: true, method: undefined });
        toast.success('App lock removed');
        onClose();
      } catch (err) {
        failCurrent(err);
      } finally {
        setBusy(false);
      }
      return;
    }
    setCurrentSecret(secret);
    goto('choose');
  };

  const onFirst = (secret) => {
    if (method === 'pattern' && secret.split(',').length < MIN_PATTERN_DOTS) {
      goto('choose', `Connect at least ${MIN_PATTERN_DOTS} dots`, true);
      return;
    }
    setFirst(secret);
    goto('confirm');
  };

  const onConfirm = async (secret) => {
    if (secret !== first) {
      goto('choose', `That didn't match. Let's try again`, true);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'create') {
        await api.auth.setup({ method, secret });
        patchStatus({ configured: true, authenticated: true, method });
        toast.success(`App lock is on. DhanFlow will ask for your ${methodName(method)}`);
      } else {
        await api.auth.update({ currentSecret, method, secret });
        patchStatus({ method });
        toast.success(`${methodName(method)[0].toUpperCase()}${methodName(method).slice(1)} updated. Other devices were signed out`);
      }
      onClose();
    } catch (err) {
      failCurrent(err);
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    current: `Enter your current ${methodName(currentMethod)}`,
    choose: method === 'pattern' ? 'Draw a new pattern' : 'Choose a 4–8 digit PIN',
    confirm: method === 'pattern' ? 'Draw it once more to confirm' : 'Enter the PIN again to confirm',
  };

  return (
    <div className="space-y-5">
      <button type="button" className="btn-ghost -ml-2 px-2 py-1 text-xs" onClick={onClose}>
        <ArrowLeft size={14} /> Back to settings
      </button>

      {step === 'choose' && (
        <div className="flex justify-center">
          <Segmented
            value={method}
            onChange={(m) => {
              setMethod(m);
              setNote('');
              setPadKey((k) => k + 1);
            }}
            options={[
              { value: 'pattern', label: 'Pattern' },
              { value: 'pin', label: 'PIN' },
            ]}
          />
        </div>
      )}

      <div className="text-center">
        <p className="font-display text-lg font-semibold text-white">{titles[step]}</p>
        <p className={`mt-1 min-h-5 text-sm ${tone === 'error' ? 'text-rose-300' : 'text-white/45'}`}>
          {note || (step === 'choose' && method === 'pattern' ? `Connect at least ${MIN_PATTERN_DOTS} dots` : '')}
        </p>
      </div>

      <SecretPad
        key={`${step}-${method}-${padKey}`}
        method={step === 'current' ? currentMethod : method}
        tone={tone}
        disabled={busy}
        submitLabel={step === 'confirm' ? 'Save' : 'Next'}
        onDone={step === 'current' ? onCurrent : step === 'choose' ? onFirst : onConfirm}
      />

      {busy && (
        <div className="flex justify-center">
          <Spinner />
        </div>
      )}
    </div>
  );
}

/** Settings block: app lock on/off, lock now, hide amounts. */
export function SecuritySection({ onFlowChange }) {
  const { status, configured, lockNow } = useAuth();
  const { amountsHidden, setAmountsHidden, setSettingsOpen } = useUI();

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-white">
              {configured ? <ShieldCheck size={15} className="text-neon" /> : <ShieldOff size={15} className="text-amber-300" />}
              App lock {configured ? <span className="text-neon">on · {methodName(status.method)}</span> : <span className="text-amber-300">off</span>}
            </p>
            <p className="mt-0.5 text-xs text-white/45">
              {configured
                ? `Asked when you open DhanFlow in a new tab or browser, and after Lock now. Switching tabs or apps doesn't lock it.`
                : 'Anyone holding your phone or laptop can see your balances. Add a pattern or PIN.'}
            </p>
          </div>
          {!configured && (
            <button type="button" className="btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={() => onFlowChange('create')}>
              <Grip size={14} /> Set up
            </button>
          )}
        </div>

        {configured && (
          <>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                onClick={() => {
                  setSettingsOpen(false);
                  lockNow();
                }}
              >
                <LockKeyhole size={14} /> Lock now
              </button>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => onFlowChange('change')}>
                <KeyRound size={14} /> Change {methodName(status.method)}
              </button>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs text-rose-300 hover:text-rose-200" onClick={() => onFlowChange('remove')}>
                Remove lock
              </button>
            </div>
          </>
        )}
      </div>

      <Toggle
        title="Hide amounts"
        hint="Masks every rupee figure on screen (M). Turns on by itself after you unlock; tap the eye to reveal."
        checked={amountsHidden}
        onChange={setAmountsHidden}
        icon={EyeOff}
      />
    </div>
  );
}