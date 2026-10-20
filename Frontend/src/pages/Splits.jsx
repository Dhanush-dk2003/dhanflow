import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeftRight, CircleCheck, Clock, Copy, HandCoins, MessageCircle, Scale, Undo2, Users, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  useDebts,
  useMarkPaid,
  useMarkUnpaid,
  usePayDebt,
  usePeople,
  useSettings,
  useSettleUp,
  useSplits,
  useUnpayDebt,
} from '../hooks/queries';
import { usePalette } from '../context/UIContext';
import { BRAND } from '../lib/constants';
import { fmtDate, localISODate, money, moneyExact, moneyWhole, round2 } from '../lib/format';
import { AccountPicker, useAccountData } from '../components/accounts';
import { useConfirm } from '../components/ConfirmDialog';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Modal,
  PageHeader,
  ProgressBar,
  Segmented,
  Spinner,
  StatTile,
} from '../components/ui';

const DAY_MS = 86_400_000;
const samePerson = (a, b) => a.toLowerCase() === b.toLowerCase();
const peopleCount = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
const itemLine = (r) => `• ${r.description || r.category} (${fmtDate(r.date)}): ${moneyExact(r.amount)}`;

function reminderText(person, shares, debts, myName) {
  if (!debts.length) {
    return `Hey ${person.name}, just a friendly reminder. You owe me ${moneyExact(person.pending)} for:\n${shares.map(itemLine).join('\n')}\n\nThanks! – ${myName}`;
  }
  const outcome =
    person.net > 0
      ? `So after netting, you just need to send me ${moneyExact(person.net)}.`
      : person.net < 0
        ? `So after netting, I'll send you ${moneyExact(-person.net)}.`
        : "So after netting, we're even. Nobody needs to pay.";
  return [
    `Hey ${person.name}, settling up our splits:`,
    ...(shares.length ? [`\nYou owe me ${moneyExact(person.pending)}:\n${shares.map(itemLine).join('\n')}`] : []),
    `\nI owe you ${moneyExact(person.owe)}:\n${debts.map(itemLine).join('\n')}`,
    `\n${outcome}`,
    `\nThanks! – ${myName}`,
  ].join('\n');
}

function netLabel(person) {
  if (person.net > 0) return { label: 'Owes you', tone: 'text-orchid', amount: person.net };
  if (person.net < 0) return { label: 'You owe', tone: 'text-amber-300', amount: -person.net };
  return { label: 'Even', tone: 'text-white', amount: 0 };
}

function PersonCard({ person, active, onClick, onRemind, onSettle }) {
  const palette = usePalette();
  const progress = person.total ? (person.paid / person.total) * 100 : 0;
  const settled = person.pending <= 0 && person.owe <= 0;
  const both = person.pending > 0 && person.owe > 0;
  const net = netLabel(person);
  return (
    <motion.div
      layout
      whileHover={{ y: -4 }}
      onClick={onClick}
      className={`glass cursor-pointer p-4 transition ${active ? 'border-neon/50 shadow-[0_0_0_4px_rgba(198,255,61,0.08)]' : 'hover:border-white/20'}`}
    >
      <div className="flex items-center gap-3">
        <Avatar name={person.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{person.name}</p>
          <p className="text-xs text-white/40">
            {[
              person.count && `${person.count} ${person.count === 1 ? 'split' : 'splits'}`,
              person.oweCount && `you owe for ${person.oweCount}`,
            ]
              .filter(Boolean)
              .join(' · ') || 'All settled'}
          </p>
        </div>
        {settled ? (
          <Badge tone="emerald">
            <CircleCheck size={11} /> Settled
          </Badge>
        ) : (
          <div className="text-right">
            <p className="text-[11px] text-white/40">{both ? `Net · ${net.label.toLowerCase()}` : net.label}</p>
            <p className={`num font-semibold ${net.tone}`}>{moneyWhole(net.amount)}</p>
          </div>
        )}
      </div>

      {both && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-xl bg-black/25 px-2.5 py-1.5">
            <p className="text-white/40">Owes you</p>
            <p className="num font-semibold text-orchid">{moneyWhole(person.pending)}</p>
          </div>
          <div className="rounded-xl bg-black/25 px-2.5 py-1.5">
            <p className="text-white/40">You owe</p>
            <p className="num font-semibold text-amber-300">{moneyWhole(person.owe)}</p>
          </div>
        </div>
      )}

      {person.total > 0 && <ProgressBar percent={progress} color={palette.neon} className="mt-4 h-1.5" />}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-white/40">
          {person.total > 0 ? `Paid back ${moneyWhole(person.paid)} of ${moneyWhole(person.total)}` : `You owe ${moneyWhole(person.owe)}`}
        </p>
        <div className="ml-auto flex shrink-0 gap-1.5">
          {!settled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemind(person);
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#25D366]/15 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-[#25D366]/25"
              style={{ color: palette.whatsapp }}
              title="Send a WhatsApp reminder"
            >
              <MessageCircle size={12} /> Remind
            </button>
          )}
          {both && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSettle(person);
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-neon/15 px-2.5 py-1 text-[11px] font-semibold text-neon transition hover:bg-neon/25"
              title="Net both sides and settle in one go"
            >
              <Scale size={12} /> Settle up
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function Splits() {
  const [status, setStatus] = useState('pending');
  const [person, setPerson] = useState('');
  const [paying, setPaying] = useState(null);
  const [payingBack, setPayingBack] = useState(null);
  const [settling, setSettling] = useState(null);
  const { data: people = [], isLoading: peopleLoading, error } = usePeople();
  const { data, isLoading } = useSplits({ status, person });
  const { data: debts } = useDebts({ status, person: person || undefined });
  const { data: allPending } = useSplits({ status: 'pending' });
  const { data: allDebts } = useDebts({ status: 'pending' });
  const { data: settings } = useSettings();
  const markPaid = useMarkPaid();
  const markUnpaid = useMarkUnpaid();
  const payDebt = usePayDebt();
  const unpayDebt = useUnpayDebt();
  const settleUp = useSettleUp();
  const confirm = useConfirm();

  const totalPending = round2(people.reduce((s, p) => s + p.pending, 0));
  const totalPaid = round2(people.reduce((s, p) => s + p.paid, 0));
  const totalOwe = round2(people.reduce((s, p) => s + p.owe, 0));
  const busy = markPaid.isPending || markUnpaid.isPending || payDebt.isPending || unpayDebt.isPending;
  const reminderDays = settings?.reminderAfterDays ?? 7;

  const itemsOf = (p) => ({
    shares: (allPending?.items ?? []).filter((r) => samePerson(r.name, p.name)),
    debts: (allDebts?.items ?? []).filter((r) => samePerson(r.name, p.name)),
  });

  const textFor = (p) => {
    const { shares, debts: owed } = itemsOf(p);
    return reminderText(p, shares, owed, settings?.name ?? BRAND.owner);
  };

  const remind = (p) => window.open(`https://wa.me/?text=${encodeURIComponent(textFor(p))}`, '_blank', 'noopener');

  const copyReminder = async (p) => {
    await navigator.clipboard.writeText(textFor(p));
    toast.success(`Reminder for ${p.name} copied`);
  };

  const handlePay = (row, body) =>
    markPaid.mutate(
      { transactionId: row.transactionId, participantId: row.participantId, name: row.name, body },
      { onSuccess: () => setPaying(null) },
    );

  const handleUnpay = (row) =>
    confirm({
      tone: 'warning',
      icon: Undo2,
      title: `Undo ${row.name}'s payment?`,
      message: `${money(row.amount)} will be taken off your balance and ${row.name} will owe you again.`,
      confirmLabel: 'Undo payment',
      action: () => markUnpaid.mutateAsync({ transactionId: row.transactionId, participantId: row.participantId, name: row.name }),
    });

  const handlePayBack = (row, body) =>
    payDebt.mutate({ transactionId: row.transactionId, name: row.name, body }, { onSuccess: () => setPayingBack(null) });

  const handleUnpayBack = (row) =>
    confirm({
      tone: 'warning',
      icon: Undo2,
      title: `Undo paying ${row.name} back?`,
      message: `${money(row.amount)} goes back on your balance and you'll owe ${row.name} again.`,
      confirmLabel: 'Undo',
      action: () => unpayDebt.mutateAsync({ transactionId: row.transactionId, name: row.name }),
    });

  const handleSettle = (p, body) =>
    settleUp.mutate(
      { name: p.name, ...body },
      {
        onSuccess: (r) => {
          setSettling(null);
          toast.success(
            r.net > 0
              ? `Settled with ${r.name}: ${money(r.net)} added to your balance`
              : r.net < 0
                ? `Settled with ${r.name}: ${money(-r.net)} paid from your balance`
                : `Settled with ${r.name}: you were even`,
          );
        },
      },
    );

  const selectedPerson = people.find((p) => samePerson(p.name, person));
  const debtItems = debts?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Splits"
        title="Collect"
        subtitle={`Money your friends owe you, and what you owe them, netted per person. I'll nudge you if anyone takes longer than ${reminderDays} days.`}
      />

      {error && <ErrorState error={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="To collect" value={totalPending} icon={Clock} accent="text-orchid" hint={`Collected ${moneyWhole(totalPaid)} so far`} />
        <StatTile
          label="You owe"
          value={totalOwe}
          icon={Wallet}
          accent="text-amber-300"
          delay={0.05}
          hint={totalOwe ? `To ${peopleCount(people.filter((p) => p.owe > 0).length)}` : 'Nothing to pay back'}
        />
        <StatTile
          label="Net"
          value={round2(totalPending - totalOwe)}
          icon={ArrowLeftRight}
          accent="text-neon"
          delay={0.1}
          hint={totalPending - totalOwe >= 0 ? 'Coming to you after netting' : 'You pay after netting'}
        />
        <StatTile
          label="People"
          value={people.length}
          format={(n) => Math.round(n)}
          icon={Users}
          accent="text-aqua"
          delay={0.15}
          hint={`${people.filter((p) => p.net > 0).length} still owe you`}
        />
      </div>

      {peopleLoading ? (
        <LoadingBlock />
      ) : people.length ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {people.map((p) => (
            <PersonCard
              key={p.name}
              person={p}
              active={samePerson(person, p.name)}
              onClick={() => setPerson((cur) => (samePerson(cur, p.name) ? '' : p.name))}
              onRemind={remind}
              onSettle={setSettling}
            />
          ))}
        </div>
      ) : null}

      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-1 pb-3">
          <Segmented
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'paid', label: 'Paid' },
              { value: 'all', label: 'All' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {selectedPerson && selectedPerson.pending > 0 && selectedPerson.owe > 0 && (
              <button className="chip chip-active" onClick={() => setSettling(selectedPerson)}>
                <Scale size={12} /> Settle up
              </button>
            )}
            {selectedPerson && (selectedPerson.pending > 0 || selectedPerson.owe > 0) && (
              <button className="chip" onClick={() => copyReminder(selectedPerson)}>
                <Copy size={12} /> Copy reminder
              </button>
            )}
            {person && (
              <button onClick={() => setPerson('')} className="chip chip-active">
                {person} <X size={12} />
              </button>
            )}
            {data && (
              <span className="text-xs text-white/45">
                Pending <span className="num font-semibold text-orchid">{money(data.totals.pending)}</span> · Paid{' '}
                <span className="num font-semibold text-neon">{money(data.totals.paid)}</span>
              </span>
            )}
          </div>
        </div>

        {isLoading ? (
          <LoadingBlock />
        ) : data?.items.length ? (
          <ul className="space-y-0.5">
            {data.items.map((row, i) => {
              const days = Math.floor((Date.now() - new Date(row.date).getTime()) / DAY_MS);
              const overdue = !row.isPaid && days >= reminderDays;
              return (
                <motion.li
                  key={row.participantId}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className="flex flex-wrap items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-white/[0.04] sm:flex-nowrap"
                >
                  <Avatar name={row.name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-white">
                      <span className="font-semibold">{row.name}</span>
                      <span className="text-white/45"> · {row.description || row.category}</span>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-white/40">
                      <span>{fmtDate(row.date)}</span>
                      <span>bill {money(row.totalAmount)}</span>
                      {row.isPaid && row.paidAt && <span>paid {fmtDate(row.paidAt)}</span>}
                      {overdue && <Badge tone="rose">{days} days overdue</Badge>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`num text-base font-semibold ${row.isPaid ? 'text-neon' : 'text-orchid'}`}>{money(row.amount)}</span>
                    {row.isPaid ? (
                      <>
                        <Badge tone="emerald">
                          <CircleCheck size={11} /> Paid
                        </Badge>
                        <button className="btn-icon h-8 w-8" title="Undo, mark as unpaid" disabled={busy} onClick={() => handleUnpay(row)}>
                          <Undo2 size={15} />
                        </button>
                      </>
                    ) : (
                      <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => setPaying(row)}>
                        <CircleCheck size={14} /> Got it
                      </button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={HandCoins}
            title={status === 'pending' ? 'Nothing to collect' : 'No splits here'}
            message={people.length ? 'Everyone in this view is settled up.' : 'Add an expense and turn on "Split with friends" to track who owes you.'}
          />
        )}
      </Card>

      {debtItems.length > 0 && (
        <Card className="mt-6 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-1 pb-3">
            <div>
              <p className="font-semibold text-white">You owe</p>
              <p className="text-xs text-white/45">Bills a friend paid for you. Pay back one by one, or use Settle up to net it against what they owe you.</p>
            </div>
            <span className="text-xs text-white/45">
              Pending <span className="num font-semibold text-amber-300">{money(debts.totals.pending)}</span> · Paid back{' '}
              <span className="num font-semibold text-neon">{money(debts.totals.paid)}</span>
            </span>
          </div>
          <ul className="space-y-0.5">
            {debtItems.map((row) => (
              <li
                key={row.transactionId}
                className="flex flex-wrap items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-white/[0.04] sm:flex-nowrap"
              >
                <Avatar name={row.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-white">
                    <span className="font-semibold">{row.name}</span>
                    <span className="text-white/45"> paid · {row.description || row.category}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-white/40">
                    <span>{fmtDate(row.date)}</span>
                    {row.isPaid && row.paidAt && <span>paid back {fmtDate(row.paidAt)}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`num text-base font-semibold ${row.isPaid ? 'text-neon' : 'text-amber-300'}`}>{money(row.amount)}</span>
                  {row.isPaid ? (
                    <>
                      <Badge tone="emerald">
                        <CircleCheck size={11} /> Paid back
                      </Badge>
                      <button className="btn-icon h-8 w-8" title="Undo, I still owe this" disabled={busy} onClick={() => handleUnpayBack(row)}>
                        <Undo2 size={15} />
                      </button>
                    </>
                  ) : (
                    <button className="btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => setPayingBack(row)}>
                      <Wallet size={14} /> Paid back
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={!!paying} title="Mark as paid" onClose={() => setPaying(null)} size="max-w-md">
        {paying && <PayForm key={paying.participantId} row={paying} pending={markPaid.isPending} onSubmit={handlePay} onCancel={() => setPaying(null)} />}
      </Modal>
      <Modal open={!!payingBack} title="Paid them back" onClose={() => setPayingBack(null)} size="max-w-md">
        {payingBack && (
          <PayForm
            key={payingBack.transactionId}
            row={payingBack}
            outgoing
            pending={payDebt.isPending}
            onSubmit={handlePayBack}
            onCancel={() => setPayingBack(null)}
          />
        )}
      </Modal>
      <Modal open={!!settling} title={settling ? `Settle up with ${settling.name}` : 'Settle up'} onClose={() => setSettling(null)} size="max-w-md">
        {settling && (
          <SettleForm
            key={settling.name}
            person={settling}
            {...itemsOf(settling)}
            pending={settleUp.isPending}
            onSubmit={handleSettle}
            onCancel={() => setSettling(null)}
          />
        )}
      </Modal>
    </>
  );
}

function useDefaultAccount(accountId) {
  const { active, byId, defaultId } = useAccountData();
  const preferred = byId.get(accountId);
  return { active, initial: preferred && !preferred.archived ? preferred._id : defaultId };
}

function PayForm({ row, outgoing = false, pending, onSubmit, onCancel }) {
  const { active, initial } = useDefaultAccount(row.account);
  const [account, setAccount] = useState(initial);
  const [date, setDate] = useState(localISODate());

  const submit = (e) => {
    e.preventDefault();
    onSubmit(row, { date, ...(account ? { account } : {}) });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-3 rounded-2xl bg-black/20 p-4">
        <Avatar name={row.name} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{outgoing ? `You paid ${row.name} back` : `${row.name} paid you back`}</p>
          <p className="truncate text-xs text-white/45">for {row.description || row.category}</p>
        </div>
        <p className={`num text-xl font-semibold ${outgoing ? 'text-amber-300' : 'text-neon'}`}>{money(row.amount)}</p>
      </div>

      {active.length > 0 && (
        <div>
          <span className="label">{outgoing ? 'Paid from' : 'Received in'}</span>
          <AccountPicker accounts={active} value={account} onChange={setAccount} />
        </div>
      )}

      <div>
        <label className="label" htmlFor="pay-date">{outgoing ? 'Date paid' : 'Date received'}</label>
        <input id="pay-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending && <Spinner className="text-black" />}
          <CircleCheck size={15} /> {outgoing ? 'Take from balance' : 'Add to balance'}
        </button>
      </div>
    </form>
  );
}

function SettleForm({ person, shares, debts, pending, onSubmit, onCancel }) {
  const { active, initial } = useDefaultAccount(shares[0]?.account ?? debts[0]?.account);
  const [account, setAccount] = useState(initial);
  const [date, setDate] = useState(localISODate());
  const net = person.net;

  const submit = (e) => {
    e.preventDefault();
    onSubmit(person, { date, ...(account ? { account } : {}) });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-3 rounded-2xl bg-black/20 p-4 text-sm">
        <Breakdown title={`${person.name} owes you`} rows={shares} total={person.pending} tone="text-orchid" />
        <Breakdown title={`You owe ${person.name}`} rows={debts} total={person.owe} tone="text-amber-300" minus />
        <div className="flex items-center justify-between border-t border-white/10 pt-3">
          <p className="font-semibold text-white">
            {net > 0 ? `${person.name} pays you` : net < 0 ? `You pay ${person.name}` : "You're even"}
          </p>
          <p className={`num text-xl font-semibold ${net > 0 ? 'text-neon' : net < 0 ? 'text-amber-300' : 'text-white'}`}>{money(Math.abs(net))}</p>
        </div>
      </div>

      {active.length > 0 && (
        <div>
          <span className="label">{net >= 0 ? 'Received in' : 'Paid from'}</span>
          <AccountPicker accounts={active} value={account} onChange={setAccount} />
        </div>
      )}

      <div>
        <label className="label" htmlFor="settle-date">Date</label>
        <input id="settle-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <p className="text-xs text-white/45">
        Everything above is marked settled. Only the difference moves in the account you pick, just like a PhonePe split.
      </p>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending && <Spinner className="text-black" />}
          <Scale size={15} /> Settle up
        </button>
      </div>
    </form>
  );
}

function Breakdown({ title, rows, total, tone, minus = false }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-white/70">{title}</p>
        <p className={`num font-semibold ${tone}`}>
          {minus ? '− ' : ''}
          {money(total)}
        </p>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-white/40">
        {rows.map((r) => (
          <li key={r.participantId ?? r.transactionId} className="flex justify-between gap-3">
            <span className="truncate">
              {r.description || r.category} · {fmtDate(r.date)}
            </span>
            <span className="num">{money(r.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
