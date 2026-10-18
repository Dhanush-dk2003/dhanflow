import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  Bell,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  HandCoins,
  MessageCircle,
  MonitorCog,
  Pencil,
  PiggyBank,
  Plus,
  Settings2,
  ShieldAlert,
  Table2,
  Trash2,
  Undo2,
  Wallet,
} from 'lucide-react';
import { fmtDate, money } from '../lib/format';
import { Spinner } from './ui';

// Charts pull in recharts; load it only when a chart is shown.
const AskChart = lazy(() => import('./AskChart'));

const METHOD_NAMES = { upi: 'UPI', cash: 'Cash', card: 'Card', bank: 'Bank', other: 'Other' };

const SIGN = { credit: '+', debit: '−', transfer: '' };
const TYPE_NAMES = { credit: 'Income', debit: 'Expense', transfer: 'Transfer' };

function EntryRow({ item, struck = false }) {
  const transfer = item.type === 'transfer';
  return (
    <li className={`flex items-center justify-between gap-3 py-1.5 text-xs ${struck ? 'opacity-40 line-through' : ''}`}>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate font-medium text-white/85">
          {transfer && <ArrowLeftRight size={12} className="shrink-0 text-aqua" />}
          {transfer ? `${item.account ?? '?'} → ${item.toAccount ?? '?'}` : item.description || item.category}
        </p>
        <p className="truncate text-[11px] text-white/40">
          {[transfer ? item.description : item.description && item.category, fmtDate(item.date), !transfer && item.account].filter(Boolean).join(' · ')}
        </p>
        {item.splitWith && <p className="truncate text-[11px] text-white/40">Split: {item.splitWith}</p>}
      </div>
      <span className={`num shrink-0 font-semibold ${item.type === 'credit' ? 'text-neon' : transfer ? 'text-aqua' : 'text-white'}`}>
        {SIGN[item.type]}
        {money(item.amount)}
      </span>
    </li>
  );
}

function DiffRow({ label, from, to }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2">
      <span className="w-24 text-white/40">{label}</span>
      <span className="text-white/45 line-through">{from || '—'}</span>
      <span className="text-white/30">→</span>
      <span className="font-medium text-white">{to || '—'}</span>
    </li>
  );
}

function UndoFooter({ undone, doneText, busy, onUndo }) {
  return undone ? (
    <Status>
      <Undo2 size={12} /> {doneText}
    </Status>
  ) : (
    <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onUndo} disabled={busy}>
      <Undo2 size={13} /> Undo
    </button>
  );
}

function Shell({ icon: Icon, tone = 'text-neon', title, children, footer }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-white/80">
        <Icon size={14} className={tone} /> {title}
      </p>
      {children}
      {footer && <div className="mt-2.5 flex flex-wrap items-center gap-2">{footer}</div>}
    </div>
  );
}

const Status = ({ children }) => <span className="flex items-center gap-1 text-[11px] text-white/45">{children}</span>;

function useRun(fn) {
  const [busy, setBusy] = useState(false);
  return [
    busy,
    async (...args) => {
      setBusy(true);
      try {
        await fn(...args);
      } finally {
        setBusy(false);
      }
    },
  ];
}

function CreatedCard({ action, onAct, onClose }) {
  const [busy, run] = useRun(() => onAct('undo'));
  const undone = action.state === 'undone';
  return (
    <Shell
      icon={Plus}
      title={`${undone ? 'Removed' : 'Added'} ${action.items.length === 1 ? '1 entry' : `${action.items.length} entries`}`}
      footer={
        undone ? (
          <Status>
            <Undo2 size={12} /> Undone
          </Status>
        ) : (
          <>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={run} disabled={busy}>
              <Undo2 size={13} /> Undo
            </button>
            <Link to="/transactions" className="btn-ghost px-3 py-1.5 text-xs" onClick={onClose}>
              Open Activity
            </Link>
          </>
        )
      }
    >
      <ul className="divide-y divide-white/[0.05]">
        {action.items.map((item) => (
          <EntryRow key={item.id} item={item} struck={undone} />
        ))}
      </ul>
    </Shell>
  );
}

function UpdatedCard({ action, onAct }) {
  const [busy, run] = useRun(() => onAct('undo'));
  const { before, after } = action;
  const fields = [
    ['amount', 'Amount', money],
    ['description', 'Description', String],
    ['category', 'Category', String],
    ['date', 'Date', fmtDate],
    ['account', after.type === 'transfer' ? 'From' : 'Account', String],
    ['toAccount', 'To', String],
    ['type', 'Type', (v) => TYPE_NAMES[v]],
    ['splitWith', 'Split', String],
  ].filter(([k]) => before[k] !== after[k]);
  const undone = action.state === 'undone';
  return (
    <Shell
      icon={Pencil}
      tone="text-aqua"
      title={`${undone ? 'Change undone' : 'Updated'}: ${after.description || after.category}`}
      footer={<UndoFooter undone={undone} doneText="Back to how it was" busy={busy} onUndo={run} />}
    >
      <ul className="space-y-1 pt-1 text-xs">
        {fields.map(([k, label, show]) => (
          <DiffRow key={k} label={label} from={before[k] && show(before[k])} to={after[k] && show(after[k])} />
        ))}
        {action.undo?.paymentMethod && <li className="text-[11px] text-white/40">Payment method changed (was {METHOD_NAMES[action.undo.paymentMethod]})</li>}
        {!fields.length && !action.undo?.paymentMethod && <li className="text-white/45">No visible changes</li>}
      </ul>
    </Shell>
  );
}

function DeleteCard({ action, onAct }) {
  const [busy, run] = useRun((choice) => onAct(choice));
  const n = action.items.length;
  return (
    <Shell
      icon={Trash2}
      tone="text-rose-300"
      title={action.state === 'deleted' ? `Deleted ${n === 1 ? '1 entry' : `${n} entries`}` : `Delete ${n === 1 ? 'this entry' : `these ${n} entries`}?`}
      footer={
        action.state === 'deleted' ? (
          <Status>
            <Check size={12} /> Deleted
          </Status>
        ) : action.state === 'kept' ? (
          <Status>Kept, nothing deleted</Status>
        ) : (
          <>
            <button
              type="button"
              className="btn-secondary border-rose-400/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/15"
              onClick={() => run('delete')}
              disabled={busy}
            >
              <Trash2 size={13} /> Delete
            </button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => run('keep')} disabled={busy}>
              Keep
            </button>
          </>
        )
      }
    >
      <ul className="divide-y divide-white/[0.05]">
        {action.items.map((item) => (
          <EntryRow key={item.id} item={item} struck={action.state === 'deleted'} />
        ))}
      </ul>
    </Shell>
  );
}

const FORMATS = [
  { id: 'csv', label: 'CSV' },
  { id: 'xlsx', label: 'Excel' },
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'Word' },
];
const FORMAT_LABELS = { xlsx: 'Excel', csv: 'CSV', pdf: 'PDF', docx: 'Word' };

function cellText(value, type) {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money') return money(value);
  if (type === 'date') return fmtDate(value);
  if (type === 'days') return `${value} ${Number(value) === 1 ? 'day' : 'days'}`;
  if (type === 'percent') return `${Math.round(Number(value))}%`;
  if (type === 'number') return Number(value).toLocaleString('en-IN');
  return String(value);
}
const NUMERIC = new Set(['money', 'number', 'days', 'percent']);
const PREVIEW_ROWS = 8;

function TableCard({ action, onAct }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(null);
  const rows = expanded ? action.rows : action.rows.slice(0, PREVIEW_ROWS);
  const get = async (format) => {
    setBusy(format);
    try {
      await onAct(`download:${format}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <Table2 size={14} className="text-aqua" /> {action.title}
          </p>
          <p className="text-[11px] text-white/40">
            {action.subtitle} · {action.count} {action.count === 1 ? 'row' : 'rows'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {FORMATS.map((f) => (
            <button key={f.id} type="button" className="btn-secondary px-2.5 py-1 text-[11px]" onClick={() => get(f.id)} disabled={busy !== null} title={`Download as ${f.label}`}>
              {busy === f.id ? <Spinner /> : <Download size={12} />} {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              {action.columns.map((c) => (
                <th key={c.key} className={`border-b border-white/[0.08] px-2 py-1.5 font-medium whitespace-nowrap text-white/45 ${NUMERIC.has(c.type) ? 'text-right' : 'text-left'}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="odd:bg-white/[0.02]">
                {action.columns.map((c) => {
                  const v = r[c.key];
                  const negative = c.type === 'money' && Number(v) < 0;
                  return (
                    <td
                      key={c.key}
                      className={`max-w-56 truncate px-2 py-1.5 whitespace-nowrap ${NUMERIC.has(c.type) ? 'num text-right' : ''} ${
                        negative ? 'text-rose-300' : v === 'Pending' ? 'text-amber-300' : v === 'Paid' ? 'text-neon' : 'text-white/80'
                      }`}
                      title={typeof v === 'string' ? v : undefined}
                    >
                      {cellText(v, c.type)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(action.rows.length > PREVIEW_ROWS || action.count > action.rows.length) && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-white/45">
          {action.rows.length > PREVIEW_ROWS && (
            <button type="button" className="text-aqua hover:underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Show less' : `Show all ${action.rows.length}`}
            </button>
          )}
          {action.count > action.rows.length && <span>The download has all {action.count} rows.</span>}
        </div>
      )}
    </div>
  );
}

function ExportCard({ action, onAct }) {
  const [busy, run] = useRun(() => onAct('download'));
  const format = action.format ?? 'xlsx';
  let title = action.title;
  let details = action.subtitle;
  if (!action.report) {
    // Older chats saved Excel exports of entries with their filters.
    const f = action.filters ?? {};
    title = { debit: 'Expenses', credit: 'Income', transfer: 'Transfers' }[f.type] ?? 'All entries';
    details = [f.from || f.to ? `${f.from ? fmtDate(f.from) : 'Start'} – ${f.to ? fmtDate(f.to) : 'today'}` : 'All time', f.category, f.account && `${f.account} account`, f.search && `“${f.search}”`]
      .filter(Boolean)
      .join(' · ');
  }
  return (
    <Shell
      icon={FileSpreadsheet}
      title={`${FORMAT_LABELS[format]} · ${title} · ${action.count} ${action.count === 1 ? 'row' : 'rows'}`}
      footer={
        <>
          <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={run} disabled={busy}>
            <Download size={13} /> {action.state === 'downloaded' ? 'Download again' : `Download .${format}`}
          </button>
          {action.state === 'downloaded' && (
            <Status>
              <Check size={12} /> Downloaded
            </Status>
          )}
        </>
      }
    >
      <p className="text-[11px] text-white/45">{details}</p>
    </Shell>
  );
}

function SplitCard({ action, onAct }) {
  const [busy, run] = useRun(() => onAct('undo'));
  const collected = action.mode === 'collected';
  const undone = action.state === 'undone';
  const total = action.items.reduce((s, i) => s + i.amount, 0);
  const title = collected ? (undone ? 'Repayment undone' : `${action.items[0].name} paid back ${money(total)}`) : undone ? 'Marked paid again' : 'Marked not paid';
  return (
    <Shell
      icon={HandCoins}
      tone={collected ? 'text-neon' : 'text-amber-300'}
      title={title}
      footer={
        <>
          <UndoFooter undone={undone} doneText={collected ? 'Back to unpaid' : 'Back to paid'} busy={busy} onUndo={run} />
          {!undone && (
            <Link to="/splits" className="btn-ghost px-3 py-1.5 text-xs">
              Open Splits
            </Link>
          )}
        </>
      }
    >
      <ul className="divide-y divide-white/[0.05]">
        {action.items.map((s) => (
          <li key={s.participantId} className={`flex items-center justify-between gap-3 py-1.5 text-xs ${undone ? 'opacity-40 line-through' : ''}`}>
            <div className="min-w-0">
              <p className="truncate font-medium text-white/85">
                {s.name} · {s.for}
              </p>
              <p className="truncate text-[11px] text-white/40">
                Bill {fmtDate(s.billDate)}
                {collected && ' · Split Repayment added'}
                {!collected && ' · Repayment entry removed'}
              </p>
            </div>
            <span className={`num shrink-0 font-semibold ${collected ? 'text-neon' : 'text-white/70'}`}>
              {collected ? '+' : ''}
              {money(s.amount)}
            </span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function BudgetCard({ action, onAct }) {
  const [busy, run] = useRun(() => onAct('undo'));
  const { before, after } = action;
  const undone = action.state === 'undone';
  const old = new Map((before?.categories ?? []).map((c) => [c.category.toLowerCase(), c.limit]));
  const kept = new Set(after.categories.map((c) => c.category.toLowerCase()));
  const rows = [
    ...(before?.total !== after.total ? [['Total', before ? money(before.total) : null, money(after.total)]] : []),
    ...after.categories
      .filter((c) => old.get(c.category.toLowerCase()) !== c.limit)
      .map((c) => [c.category, old.has(c.category.toLowerCase()) ? money(old.get(c.category.toLowerCase())) : null, money(c.limit)]),
    ...(before?.categories ?? []).filter((c) => !kept.has(c.category.toLowerCase())).map((c) => [c.category, money(c.limit), 'No limit']),
  ];
  return (
    <Shell
      icon={PiggyBank}
      tone="text-orchid"
      title={`${undone ? 'Budget change undone' : 'Budget updated'} · ${action.monthLabel}`}
      footer={
        <>
          <UndoFooter undone={undone} doneText="Back to the previous budget" busy={busy} onUndo={run} />
          {!undone && (
            <Link to="/budget" className="btn-ghost px-3 py-1.5 text-xs">
              Open Budget
            </Link>
          )}
        </>
      }
    >
      <ul className="space-y-1 pt-1 text-xs">
        {rows.map(([label, from, to]) => (
          <DiffRow key={label} label={label} from={from} to={to} />
        ))}
        {!rows.length && <li className="text-white/45">No changes</li>}
      </ul>
    </Shell>
  );
}

function AccountCard({ action, onAct }) {
  const [busy, run] = useRun(() => onAct('undo'));
  const { before, after } = action;
  const undone = action.state === 'undone';
  const created = action.mode === 'created';
  const rows = created
    ? []
    : [
        ['Name', before.name, after.name],
        ['Type', before.type, after.type],
        ['Opening', money(before.openingBalance), money(after.openingBalance)],
        ['Default', before.isDefault ? 'Yes' : 'No', after.isDefault ? 'Yes' : 'No'],
        ['Status', before.archived ? 'Archived' : 'Active', after.archived ? 'Archived' : 'Active'],
      ].filter(([, a, b]) => a !== b);
  return (
    <Shell
      icon={Wallet}
      tone="text-sky-300"
      title={`${created ? (undone ? 'Account removed' : 'Account added') : undone ? 'Change undone' : 'Account updated'}: ${after.name}`}
      footer={
        <>
          {(created || action.undo?.length > 0) && (
            <UndoFooter undone={undone} doneText={created ? 'Removed' : 'Back to how it was'} busy={busy} onUndo={run} />
          )}
          {!undone && (
            <Link to="/accounts" className="btn-ghost px-3 py-1.5 text-xs">
              Open Accounts
            </Link>
          )}
        </>
      }
    >
      {created ? (
        <p className={`text-xs text-white/55 ${undone ? 'line-through opacity-50' : ''}`}>
          {[after.type, `opening ${money(after.openingBalance)}`, after.isDefault && 'default account'].filter(Boolean).join(' · ')}
        </p>
      ) : (
        <ul className="space-y-1 pt-1 text-xs">
          {rows.map(([label, from, to]) => (
            <DiffRow key={label} label={label} from={from} to={to} />
          ))}
        </ul>
      )}
    </Shell>
  );
}

const SETTING_LABELS = {
  name: ['Your name', String],
  reminderAfterDays: ['Remind after', (v) => `${v} ${v === 1 ? 'day' : 'days'}`],
  monthEndReminder: ['Month-end summary', (v) => (v ? 'On' : 'Off')],
};

function SettingsCard({ action, onAct }) {
  const [busy, run] = useRun(() => onAct('undo'));
  const undone = action.state === 'undone';
  return (
    <Shell icon={Settings2} tone="text-aqua" title={undone ? 'Settings change undone' : 'Settings updated'} footer={<UndoFooter undone={undone} doneText="Back to how it was" busy={busy} onUndo={run} />}>
      <ul className="space-y-1 pt-1 text-xs">
        {Object.keys(action.after).map((k) => {
          const [label, show] = SETTING_LABELS[k] ?? [k, String];
          return <DiffRow key={k} label={label} from={action.before[k] !== undefined ? show(action.before[k]) : null} to={show(action.after[k])} />;
        })}
      </ul>
    </Shell>
  );
}

function ConfirmCard({ action, onAct }) {
  const [busy, run] = useRun((choice) => onAct(choice));
  return (
    <Shell
      icon={action.state === 'done' ? Check : ShieldAlert}
      tone="text-rose-300"
      title={action.state === 'done' ? action.title.replace(/\?$/, ': done') : action.title}
      footer={
        action.state === 'done' ? (
          <Status>
            <Check size={12} /> Done
          </Status>
        ) : action.state === 'cancelled' ? (
          <Status>Cancelled, nothing changed</Status>
        ) : (
          <>
            <button
              type="button"
              className="btn-secondary border-rose-400/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/15"
              onClick={() => run('confirm')}
              disabled={busy}
            >
              <Trash2 size={13} /> {action.confirmLabel ?? 'Confirm'}
            </button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => run('cancel')} disabled={busy}>
              Cancel
            </button>
          </>
        )
      }
    >
      {action.kind === 'remove_budget' && action.before && (
        <p className="text-[11px] text-white/45">
          Total {money(action.before.total)}
          {action.before.categories.length > 0 && ` · ${action.before.categories.map((c) => `${c.category} ${money(c.limit)}`).join(', ')}`}
        </p>
      )}
    </Shell>
  );
}

function NotificationsCard({ action }) {
  const text =
    action.mode === 'read'
      ? action.count
        ? `${action.count} marked as read`
        : 'Nothing unread'
      : action.added
        ? `${action.added} new · ${action.unread} unread`
        : `No new reminders · ${action.unread} unread`;
  return (
    <Shell icon={Bell} tone="text-amber-300" title="Notifications">
      <p className="text-[11px] text-white/45">{text}</p>
    </Shell>
  );
}

function RemindCard({ action, onAct }) {
  return (
    <Shell
      icon={MessageCircle}
      tone="text-emerald-300"
      title={`Reminder for ${action.person} · ${money(action.amount)}`}
      footer={
        <>
          <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => onAct('whatsapp')}>
            <MessageCircle size={13} /> {action.state === 'sent' ? 'Open WhatsApp again' : 'Send on WhatsApp'}
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onAct('copy')}>
            <Copy size={13} /> Copy
          </button>
        </>
      }
    >
      <p className="rounded-xl bg-black/20 px-3 py-2 text-[11px] whitespace-pre-wrap text-white/65">{action.text}</p>
    </Shell>
  );
}

const APP_TEXT = {
  dark_mode: 'Dark mode on',
  light_mode: 'Light mode on',
  hide_amounts: 'Amounts hidden',
  show_amounts: 'Amounts shown',
  lock_app: 'App locked',
  open_page: 'Opened a page',
  open_add_form: 'Opened the add-entry form',
  open_calculator: 'Opened the calculator',
  open_settings: 'Opened Settings',
  open_lock_setup: 'Opened app lock setup',
};

function AppCard({ action, onAct }) {
  return (
    <Shell
      icon={MonitorCog}
      tone="text-sky-300"
      title={action.command === 'open_page' ? `Opened ${action.page}` : APP_TEXT[action.command]}
      footer={
        ['open_page', 'open_add_form', 'open_calculator', 'open_settings', 'open_lock_setup'].includes(action.command) && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onAct('again')}>
            Open again
          </button>
        )
      }
    />
  );
}

/** Cards for what the assistant did. `onAct(choice)` runs the follow-up (undo, delete, download). */
export default function AskAction({ action, onAct, onClose }) {
  switch (action.type) {
    case 'chart':
      return (
        <Suspense
          fallback={
            <div className="flex h-40 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
              <Spinner />
            </div>
          }
        >
          <AskChart chart={action} />
        </Suspense>
      );
    case 'created':
      return <CreatedCard action={action} onAct={onAct} onClose={onClose} />;
    case 'updated':
      return <UpdatedCard action={action} onAct={onAct} />;
    case 'confirm_delete':
      return <DeleteCard action={action} onAct={onAct} />;
    case 'export':
      return <ExportCard action={action} onAct={onAct} />;
    case 'table':
      return <TableCard action={action} onAct={onAct} />;
    case 'split':
      return <SplitCard action={action} onAct={onAct} />;
    case 'budget':
      return <BudgetCard action={action} onAct={onAct} />;
    case 'account':
      return <AccountCard action={action} onAct={onAct} />;
    case 'settings':
      return <SettingsCard action={action} onAct={onAct} />;
    case 'confirm':
      return <ConfirmCard action={action} onAct={onAct} />;
    case 'notifications':
      return <NotificationsCard action={action} />;
    case 'remind':
      return <RemindCard action={action} onAct={onAct} />;
    case 'app':
      return <AppCard action={action} onAct={onAct} />;
    default:
      return null;
  }
}
