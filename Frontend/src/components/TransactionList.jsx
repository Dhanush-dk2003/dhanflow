import { motion } from 'motion/react';
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, HandCoins, Pencil, Trash2, Users } from 'lucide-react';
import { PAYMENT_METHODS } from '../lib/constants';
import { fmtDayHeading, money, round2, toInputDate } from '../lib/format';
import { AccountTag, useAccountData } from './accounts';
import { Badge } from './ui';

const methodLabel = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label]));

function TxnIcon({ txn }) {
  if (txn.settlementOf) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-orchid/20 bg-orchid/10 text-orchid">
        <HandCoins size={18} />
      </div>
    );
  }
  if (txn.type === 'transfer') {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-aqua/20 bg-aqua/10 text-aqua">
        <ArrowLeftRight size={18} />
      </div>
    );
  }
  const credit = txn.type === 'credit';
  const Icon = credit ? ArrowDownLeft : ArrowUpRight;
  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
        credit ? 'border-neon/20 bg-neon/10 text-neon' : 'border-rose-400/20 bg-rose-500/10 text-rose-300'
      }`}
    >
      <Icon size={18} />
    </div>
  );
}

function SplitInfo({ txn }) {
  const participants = txn.participants ?? [];
  if (!participants.length) return null;
  const owed = participants.reduce((s, p) => s + p.amount, 0);
  const pending = participants.filter((p) => !p.isPaid).length;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-white/45">
      <Users size={12} />
      <span>
        with {participants.map((p) => p.name).join(', ')} · your share {money(round2(txn.amount - owed))}
      </span>
      {pending ? <Badge tone="amber">{pending} pending</Badge> : <Badge tone="emerald">settled</Badge>}
    </div>
  );
}

function Meta({ txn, byId }) {
  const from = byId.get(txn.account);
  if (txn.type === 'transfer') {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-white/40">
        <AccountTag account={from} /> <ArrowRight size={11} /> <AccountTag account={byId.get(txn.toAccount)} />
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-white/40">
      <span>{methodLabel[txn.paymentMethod] ?? txn.paymentMethod}</span>
      {from && (
        <>
          <span className="text-white/20">·</span>
          <AccountTag account={from} />
        </>
      )}
    </p>
  );
}

/** With `accountId`, transfers are signed from that account's point of view. */
function signOf(txn, accountId) {
  if (txn.type === 'transfer') {
    if (!accountId) return 0;
    return txn.toAccount === accountId ? 1 : -1;
  }
  return txn.type === 'credit' ? 1 : -1;
}

function Row({ txn, onEdit, onDelete, compact, index, byId, accountId }) {
  const sign = signOf(txn, accountId);
  const title = txn.type === 'transfer' ? txn.description || 'Transfer' : txn.description || txn.category;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className="group flex items-center gap-3.5 rounded-2xl px-3 py-3 transition hover:bg-white/[0.04]"
    >
      <TxnIcon txn={txn} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-white">{title}</p>
          {txn.description && txn.type !== 'transfer' && <Badge>{txn.category}</Badge>}
          {txn.type === 'transfer' && <Badge tone="aqua">Transfer</Badge>}
        </div>
        {!compact && <Meta txn={txn} byId={byId} />}
        {!compact && <SplitInfo txn={txn} />}
      </div>
      <p className={`num shrink-0 text-base font-semibold ${sign > 0 ? 'text-neon' : sign < 0 ? 'text-white' : 'text-aqua'}`}>
        {sign > 0 ? '+' : sign < 0 ? '−' : ''}
        {money(txn.amount)}
      </p>
      {(onEdit || onDelete) && (
        <div className="flex shrink-0 gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
          {onEdit && (
            <button
              className="btn-icon h-8 w-8"
              onClick={() => onEdit(txn)}
              disabled={!!txn.settlementOf}
              title={txn.settlementOf ? 'Repayments are managed from Collect' : 'Edit'}
            >
              <Pencil size={14} />
            </button>
          )}
          {onDelete && (
            <button className="btn-icon h-8 w-8 hover:text-rose-300" onClick={() => onDelete(txn)} title="Delete">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </motion.li>
  );
}

/**
 * Groups by calendar day ("Today", "Yesterday", ...) unless `grouped` is false.
 * Pass `accountId` when the list is filtered to one account.
 */
export default function TransactionList({ items, onEdit, onDelete, compact = false, grouped = true, accountId }) {
  const { byId } = useAccountData();
  const rowProps = { onEdit, onDelete, compact, byId, accountId };

  if (!grouped) {
    return (
      <ul className="space-y-0.5">
        {items.map((txn, i) => (
          <Row key={txn._id} txn={txn} index={i} {...rowProps} />
        ))}
      </ul>
    );
  }

  const groups = [];
  for (const txn of items) {
    const day = toInputDate(txn.date);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(txn);
    else groups.push({ day, items: [txn] });
  }

  let index = 0;
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const net = g.items.reduce((s, t) => s + signOf(t, accountId) * t.amount, 0);
        return (
          <section key={g.day}>
            <div className="mb-1 flex items-center justify-between px-3">
              <p className="eyebrow">{fmtDayHeading(g.day)}</p>
              <p className={`num text-xs ${net >= 0 ? 'text-neon/70' : 'text-white/35'}`}>
                {net >= 0 ? '+' : '−'}
                {money(Math.abs(net))}
              </p>
            </div>
            <ul className="space-y-0.5">
              {g.items.map((txn) => (
                <Row key={txn._id} txn={txn} index={index++} {...rowProps} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
