import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArchiveRestore, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Landmark, Link2, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useAssignUnassigned, useDeleteAccount, useSaveAccount } from '../hooks/queries';
import { usePalette, useUI } from '../context/UIContext';
import { ACCOUNT_COLORS, ACCOUNT_TYPES, TRANSFER } from '../lib/constants';
import { isExpression, tryEvaluate } from '../lib/calc';
import { fmtDate, money, moneyCompact, moneyExact, round2 } from '../lib/format';
import { AccountIcon, typeLabel, useAccountColor, useAccountData } from '../components/accounts';
import { useConfirm } from '../components/ConfirmDialog';
import { AnimatedNumber, Badge, Card, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, Spinner } from '../components/ui';

function AccountForm({ account, onDone }) {
  const palette = usePalette();
  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'bank',
    openingBalance: account ? String(account.openingBalance) : '',
    color: account?.color ?? ACCOUNT_COLORS[0],
    isDefault: account?.isDefault ?? false,
  });
  const [error, setError] = useState('');
  const save = useSaveAccount();
  const remove = useDeleteAccount();
  const confirm = useConfirm();
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const opening = form.openingBalance.trim() === '' ? 0 : tryEvaluate(form.openingBalance);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Give the account a name, e.g. HDFC Savings');
    if (opening == null) return setError('Opening balance must be a number');
    save.mutate(
      { id: account?._id, data: { ...form, name: form.name.trim(), openingBalance: round2(opening) } },
      { onSuccess: onDone },
    );
  };

  const archive = () =>
    save.mutate(
      { id: account._id, data: { archived: true }, message: `${account.name} archived` },
      { onSuccess: onDone },
    );

  const destroy = () =>
    confirm({
      tone: 'danger',
      title: `Delete ${account.name}?`,
      message: account.openingBalance
        ? `It has no entries, but its opening balance of ${money(account.openingBalance)} will no longer count in your total. This can't be undone.`
        : "It has no entries, so your balance won't change. This can't be undone.",
      confirmLabel: 'Delete account',
      action: async () => {
        await remove.mutateAsync({ id: account._id, name: account.name });
        onDone();
      },
    });

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label" htmlFor="a-name">Name</label>
        <input
          id="a-name"
          className="input"
          maxLength={40}
          autoFocus
          placeholder="e.g. HDFC Savings, SBI Salary, Cash"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div>
        <span className="label">Type</span>
        <div className="flex flex-wrap gap-1.5">
          {ACCOUNT_TYPES.map((t) => (
            <button key={t.value} type="button" onClick={() => set({ type: t.value })} className={`chip ${form.type === t.value ? 'chip-active' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="a-opening">Opening balance</label>
        <input
          id="a-opening"
          inputMode="decimal"
          className="input num"
          placeholder="0"
          value={form.openingBalance}
          onChange={(e) => set({ openingBalance: e.target.value })}
        />
        <p className="mt-1.5 text-xs text-white/40">
          {isExpression(form.openingBalance) && opening != null ? (
            <span className="text-neon">= {moneyExact(opening)}</span>
          ) : form.type === 'card' ? (
            'Card dues before your first entry here, as a negative number (e.g. -4500).'
          ) : (
            'What was in this account before your first entry here.'
          )}
        </p>
      </div>

      <div>
        <span className="label">Colour</span>
        <div className="flex flex-wrap gap-2">
          {ACCOUNT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => set({ color: c })}
              className={`h-8 w-8 cursor-pointer rounded-full transition hover:scale-110 ${form.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-panel' : ''}`}
              style={{ backgroundColor: palette.accounts[c] }}
            />
          ))}
        </div>
      </div>

      {!account?.archived && (
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-white">Default account</p>
            <p className="text-xs text-white/45">Pre-selected when you add a new entry</p>
          </div>
          <input type="checkbox" className="h-5 w-5 accent-[#c6ff3d]" checked={form.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} />
        </label>
      )}

      {error && <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {account && !account.archived && (
            <button type="button" className="btn-ghost px-3 text-xs" onClick={archive} disabled={save.isPending}>
              Archive
            </button>
          )}
          {account && account.count === 0 && (
            <button type="button" className="btn-ghost px-3 text-xs hover:text-rose-300" onClick={destroy} disabled={remove.isPending}>
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {save.isPending && <Spinner className="text-black" />}
            {account ? 'Save' : 'Add account'}
          </button>
        </div>
      </div>
    </form>
  );
}

function AccountCard({ account, index, onEdit, onAdd }) {
  const color = useAccountColor(account);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4 }}
      className="glass group relative flex flex-col overflow-hidden p-5"
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full blur-3xl" style={{ backgroundColor: `${color}1c` }} />

      <div className="relative flex items-start gap-3">
        <AccountIcon account={account} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold text-white">
            {account.name}
            {account.isDefault && <Star size={13} className="shrink-0 fill-current text-amber-300" aria-label="Default account" />}
          </p>
          <p className="text-xs text-white/40">{typeLabel(account.type)}</p>
        </div>
        <button className="btn-icon h-8 w-8" onClick={() => onEdit(account)} title="Edit account">
          <Pencil size={14} />
        </button>
      </div>

      <p className={`relative mt-5 text-3xl font-bold ${account.balance < 0 ? 'text-rose-300' : 'text-white'}`}>
        <AnimatedNumber value={account.balance} />
      </p>
      <p className="relative text-[11px] text-white/35">
        {account.type === 'card' && account.balance < 0 ? 'Outstanding on this card' : 'Current balance'}
      </p>

      <div className="relative mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-black/20 px-3 py-2">
          <p className="flex items-center gap-1 text-[11px] text-white/40">
            <ArrowDownLeft size={11} /> In this month
          </p>
          <p className="num font-semibold text-neon">{moneyCompact(account.monthIn)}</p>
        </div>
        <div className="rounded-2xl bg-black/20 px-3 py-2">
          <p className="flex items-center gap-1 text-[11px] text-white/40">
            <ArrowUpRight size={11} /> Out this month
          </p>
          <p className="num font-semibold text-rose-300">{moneyCompact(account.monthOut)}</p>
        </div>
      </div>

      <div className="relative mt-auto flex items-center justify-between gap-2 pt-4">
        <button className="chip" onClick={() => onAdd(account)}>
          <Plus size={12} /> Entry
        </button>
        <Link to={`/transactions?account=${account._id}`} className="group/link flex items-center gap-1 text-xs font-medium text-white/50 hover:text-neon">
          {account.count} {account.count === 1 ? 'entry' : 'entries'}
          {account.lastUsed && ` · ${fmtDate(account.lastUsed)}`}
          <ArrowRight size={12} className="transition group-hover/link:translate-x-0.5" />
        </Link>
      </div>
    </motion.div>
  );
}

function SpreadBar({ accounts, total }) {
  const palette = usePalette();
  const positive = accounts.filter((a) => a.balance > 0);
  const sum = positive.reduce((s, a) => s + a.balance, 0);
  if (!sum) return null;
  return (
    <div className="mt-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
        {positive.map((a, i) => (
          <motion.div
            key={a._id}
            initial={{ width: 0 }}
            animate={{ width: `${(a.balance / sum) * 100}%` }}
            transition={{ duration: 0.9, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            style={{ backgroundColor: palette.accounts[a.color] ?? palette.accounts.lime }}
            title={`${a.name}: ${money(a.balance)}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-white/55">
        {positive.map((a) => (
          <span key={a._id} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette.accounts[a.color] ?? palette.accounts.lime }} />
            {a.name} <span className="num text-white/35">{Math.round((a.balance / sum) * 100)}%</span>
          </span>
        ))}
      </div>
      {total < sum && <p className="mt-2 text-[11px] text-white/35">Card dues and negative balances bring the total down.</p>}
    </div>
  );
}

function UnassignedBanner({ unassigned, accounts }) {
  const [target, setTarget] = useState('');
  const assign = useAssignUnassigned();
  const confirm = useConfirm();
  const chosen = accounts.find((a) => a._id === (target || accounts[0]?._id));

  const link = () =>
    confirm({
      icon: Link2,
      title: `Link ${unassigned.count} older ${unassigned.count === 1 ? 'entry' : 'entries'}?`,
      message: `They'll show under ${chosen.name} and its balance will include them. You can still change any entry later.`,
      confirmLabel: `Link to ${chosen.name}`,
      action: () => assign.mutateAsync({ id: chosen._id, name: chosen.name }),
    });
  return (
    <Card className="mb-5 flex flex-wrap items-center gap-4 border-amber-400/20 bg-amber-500/[0.06] p-4">
      <Link2 size={18} className="shrink-0 text-amber-300" />
      <p className="min-w-0 flex-1 text-sm text-white/70">
        <span className="font-semibold text-white">{unassigned.count} older {unassigned.count === 1 ? 'entry is' : 'entries are'}</span> not
        linked to any account ({money(unassigned.balance)}). They still count in your total balance.
      </p>
      {chosen && (
        <div className="flex items-center gap-2">
          <select className="input w-auto py-2" value={chosen._id} onChange={(e) => setTarget(e.target.value)}>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary py-2"
            disabled={assign.isPending}
            onClick={link}
          >
            Link to {chosen.name}
          </button>
        </div>
      )}
    </Card>
  );
}

export default function Accounts() {
  const { data, active, all, isLoading, error } = useAccountData();
  const { openTransaction } = useUI();
  const [editing, setEditing] = useState(null);
  const restore = useSaveAccount();
  const archived = all.filter((a) => a.archived);

  const transfer = () =>
    openTransaction(null, {
      type: 'transfer',
      category: TRANSFER,
      paymentMethod: 'bank',
      account: active[0]?._id ?? '',
      toAccount: active[1]?._id ?? '',
    });

  const addEntry = (account) =>
    openTransaction(null, { account: account._id, ...(account.type === 'cash' ? { paymentMethod: 'cash' } : {}) });

  return (
    <>
      <PageHeader
        eyebrow="Where your money sits"
        title="Accounts"
        subtitle="Every bank, wallet, card and cash pocket with its own balance. Pick the account on each entry and I'll keep them in sync."
      >
        {active.length >= 2 && (
          <button className="btn-secondary" onClick={transfer}>
            <ArrowLeftRight size={16} /> Transfer
          </button>
        )}
        <button className="btn-primary" onClick={() => setEditing({})}>
          <Plus size={16} /> Add account
        </button>
      </PageHeader>

      {error && <ErrorState error={error} />}

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <>
          {all.length > 0 && (
            <Card className="relative mb-5 overflow-hidden p-6">
              <div className="absolute inset-0 bg-gradient-to-br from-aqua/10 via-transparent to-orchid/10" />
              <div className="relative">
                <p className="eyebrow">Total across accounts</p>
                <p className={`mt-2 text-4xl font-bold ${data.total < 0 ? 'text-rose-300' : 'text-white'}`}>
                  <AnimatedNumber value={data.total} />
                </p>
                <SpreadBar accounts={active} total={data.total} />
              </div>
            </Card>
          )}

          {data?.unassigned && active.length > 0 && <UnassignedBanner unassigned={data.unassigned} accounts={active} />}

          {active.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {active.map((a, i) => (
                <AccountCard key={a._id} account={a} index={i} onEdit={setEditing} onAdd={addEntry} />
              ))}
              <motion.button
                whileHover={{ y: -4 }}
                onClick={() => setEditing({})}
                className="flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-white/15 text-sm text-white/45 transition hover:border-neon/40 hover:text-neon"
              >
                <Plus size={22} />
                Add another account
              </motion.button>
            </div>
          ) : (
            <Card className="p-4">
              <EmptyState
                icon={Landmark}
                title="Add your first account"
                message="Add each bank account, your cash and UPI wallets. Then every entry shows which account it came from, and you'll see each balance separately."
                action={
                  <button className="btn-primary" onClick={() => setEditing({})}>
                    <Plus size={16} /> Add account
                  </button>
                }
              />
            </Card>
          )}

          {archived.length > 0 && (
            <Card className="mt-6 p-3">
              <p className="eyebrow px-3 pt-2 pb-2">Archived</p>
              <ul className="space-y-0.5">
                {archived.map((a) => (
                  <li key={a._id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-white/[0.04]">
                    <AccountIcon account={a} size="h-9 w-9" iconSize={15} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white/80">{a.name}</p>
                      <p className="text-xs text-white/35">
                        {a.count} entries · balance {money(a.balance)}
                      </p>
                    </div>
                    <Badge>archived</Badge>
                    <button
                      className="btn-icon h-8 w-8"
                      title="Restore"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate({ id: a._id, data: { archived: false }, message: `${a.name} restored` })}
                    >
                      <ArchiveRestore size={15} />
                    </button>
                    <button className="btn-icon h-8 w-8" title="Edit" onClick={() => setEditing(a)}>
                      <Pencil size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <Modal open={!!editing} title={editing?._id ? `Edit ${editing.name}` : 'New account'} onClose={() => setEditing(null)}>
        {editing && <AccountForm key={editing._id ?? 'new'} account={editing._id ? editing : null} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}
