import { useCallback, useEffect, useState } from 'react';
import { BellRing, Keyboard, ShieldCheck } from 'lucide-react';
import { useSaveSettings, useSettings } from '../hooks/queries';
import { useNotificationPermission } from '../hooks/useBrowserNotifications';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { LockFlow, SecuritySection } from './SecuritySettings';
import { Modal, Segmented, Spinner } from './ui';

const SHORTCUTS = [
  ['N', 'New transaction'],
  ['C', 'Calculator'],
  ['H', 'Home'],
  ['A', 'Activity'],
  ['W', 'Accounts (wallets)'],
  ['P', 'Collect (people)'],
  ['B', 'Budget'],
  ['T', 'Light / dark theme'],
  ['M', 'Hide / show amounts'],
  ['L', 'Lock now'],
];

function ThemeChoice() {
  const { theme, setTheme } = useUI();
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div>
        <p className="text-sm font-medium text-white">Appearance</p>
        <p className="text-xs text-white/45">Saved on this device</p>
      </div>
      <Segmented
        size="sm"
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
      />
    </div>
  );
}

function SettingsForm({ settings, onDone }) {
  const [form, setForm] = useState({
    name: settings.name,
    reminderAfterDays: settings.reminderAfterDays,
    monthEndReminder: settings.monthEndReminder,
  });
  const save = useSaveSettings();
  const { permission, request, supported } = useNotificationPermission();

  const submit = (e) => {
    e.preventDefault();
    save.mutate(
      { name: form.name.trim() || 'Dhanush', reminderAfterDays: Number(form.reminderAfterDays) || 7, monthEndReminder: form.monthEndReminder },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label" htmlFor="s-name">What should I call you?</label>
        <input id="s-name" className="input" maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>

      <ThemeChoice />

      <div>
        <label className="label" htmlFor="s-days">Remind me when someone hasn't paid back after</label>
        <div className="flex items-center gap-3">
          <input
            id="s-days"
            type="range"
            min={1}
            max={30}
            className="flex-1 accent-[#c6ff3d]"
            value={form.reminderAfterDays}
            onChange={(e) => setForm({ ...form, reminderAfterDays: e.target.value })}
          />
          <span className="num w-16 text-right text-sm font-semibold text-white">{form.reminderAfterDays} days</span>
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">Month-end wrap-up</p>
          <p className="text-xs text-white/45">On the last day of the month: who owes you and how much</p>
        </div>
        <input
          type="checkbox"
          className="h-5 w-5 accent-[#c6ff3d]"
          checked={form.monthEndReminder}
          onChange={(e) => setForm({ ...form, monthEndReminder: e.target.checked })}
        />
      </label>

      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            <BellRing size={15} className="text-neon" /> Desktop alerts
          </p>
          <p className="text-xs text-white/45">
            {!supported
              ? 'Not supported in this browser'
              : permission === 'granted'
                ? 'Enabled. Reminders pop up on your desktop'
                : permission === 'denied'
                  ? 'Blocked. Allow notifications for this site in browser settings'
                  : 'Get reminders even when the tab is in the background'}
          </p>
        </div>
        {supported && permission === 'default' && (
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={request}>
            Enable
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
          <Keyboard size={15} className="text-aqua" /> Keyboard shortcuts
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} className="flex items-center gap-2 text-xs text-white/55">
              <span className="kbd">{k}</span> {label}
            </div>
          ))}
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-white/35">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        Your data stays in your own MongoDB on this computer. Turn on App lock before opening DhanFlow from your phone or putting it online.
      </p>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Spinner className="text-black" />} Save
        </button>
      </div>
    </form>
  );
}

const FLOW_TITLES = { create: 'Set up app lock', change: 'Change app lock', remove: 'Remove app lock' };

export default function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useUI();
  const { status } = useAuth();
  const { data: settings } = useSettings();
  const [flow, setFlow] = useState(null);
  const close = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);

  // `setSettingsOpen('lock-setup')` opens straight into the lock setup.
  useEffect(() => {
    setFlow(settingsOpen === 'lock-setup' ? 'create' : null);
  }, [settingsOpen]);

  return (
    <Modal open={Boolean(settingsOpen)} title={flow ? FLOW_TITLES[flow] : 'Settings'} onClose={close}>
      {flow ? (
        <LockFlow mode={flow} currentMethod={status?.method} onClose={() => (settingsOpen === 'lock-setup' ? close() : setFlow(null))} />
      ) : (
        settings && (
          <div className="space-y-5">
            <SecuritySection onFlowChange={setFlow} />
            <SettingsForm settings={settings} onDone={close} />
          </div>
        )
      )}
    </Modal>
  );
}
