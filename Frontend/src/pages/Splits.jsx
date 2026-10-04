import { useState } from 'react';
import { motion } from 'motion/react';
import { CircleCheck, Clock, Copy, HandCoins, MessageCircle, Undo2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMarkPaid, useMarkUnpaid, usePeople, useSettings, useSplits } from '../hooks/queries';
import { usePalette } from '../context/UIContext';
import { BRAND } from '../lib/constants';
import { fmtDate, localISODate, money, moneyExact, moneyWhole } from '../lib/format';
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

function reminderText(person, rows, myName) {
  const lines = rows.map((r) => `• ${r.description || r.category} (${fmtDate(r.date)}): ${moneyExact(r.amount)}`);
  return `Hey ${person.name}, just a friendly reminder. You owe me ${moneyExact(person.pending)} for:\n${lines.join('\n')}\n\nThanks! – ${myName}`;
}

function PersonCard({ person, active, onClick, onRemind }) {
  const palette = usePalette();
  const progress = person.total ? (person.paid / person.total) * 100 : 0;
  const settled = person.pending <= 0;
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
            {person.count} {person.count === 1 ? 'split' : 'splits'}
          </p>
        </div>
        {settled ? (
          <Badge tone="emerald">
            <CircleCheck size={11} /> Settled
          </Badge>
        ) : (
          <div className="text-right">
            <p className="text-[11px] text-white/40">Owes you</p>
            <p className="num font-semibold text-orchid">{moneyWhole(person.pending)}</p>
          </div>
        )}
      </div>
      <ProgressBar percent={progress} color={palette.neon} className="mt-4 h-1.5" />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[11px] text-white/40">
          Paid back {moneyWhole(person.paid)} of {moneyWhole(person.total)}
        </p>
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
      </div>
    </motion.div>
  );
}

export default function Splits() {
  const [status, setStatus] = useState('pending');
  const [person, setPerson] = useState('');
  const [paying, setPaying] = useState(null);
  const { data: people = [], isLoading: peopleLoading, error } = usePeople();
  const { data, isLoading } = useSplits({ status, person });
  const { data: allPending } = useSplits({ status: 'pending' });
  const { data: settings } = useSettings();
  const markPaid = useMarkPaid();
  const markUnpaid = useMarkUnpaid();
  const confirm = useConfirm();

  const totalPending = people.reduce((s, p) => s + p.pending, 0);
  const totalPaid = people.reduce((s, p) => s + p.paid, 0);
  const busy = markPaid.isPending || markUnpaid.isPending;
  const reminderDays = settings?.reminderAfterDays ?? 7;

  const remind = (p) => {
    const rows = (allPending?.items ?? []).filter((r) => r.name.toLowerCase() === p.name.toLowerCase());
    const text = reminderText(p, rows, settings?.name ?? BRAND.owner);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const copyReminder = async (p) => {
    const rows = (allPending?.items ?? []).filter((r) => r.name.toLowerCase() === p.name.toLowerCase());
    await navigator.clipboard.writeText(reminderText(p, rows, settings?.name ?? BRAND.owner));
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

  const selectedPerson = people.find((p) => p.name.toLowerCase() === person.toLowerCase());

  return (
    <>
      <PageHeader
        eyebrow="Splits"
        title="Collect"
        subtitle={`Money your friends owe you. I'll nudge you if anyone takes longer than ${reminderDays} days, and send a wrap-up at month end.`}
      />

      {error && <ErrorState error={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="To collect" value={totalPending} icon={Clock} accent="text-orchid" />
        <StatTile label="Collected" value={totalPaid} icon={HandCoins} delay={0.05} hint="Already in your balance" />
        <StatTile
          label="People"
          value={people.length}
          format={(n) => Math.round(n)}
          icon={Users}
          accent="text-aqua"
          delay={0.1}
          hint={`${people.filter((p) => p.pending > 0).length} still owe you`}
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
              active={person.toLowerCase() === p.name.toLowerCase()}
              onClick={() => setPerson((cur) => (cur.toLowerCase() === p.name.toLowerCase() ? '' : p.name))}
              onRemind={remind}
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
            {selectedPerson && selectedPerson.pending > 0 && (
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

      <Modal open={!!paying} title="Mark as paid" onClose={() => setPaying(null)} size="max-w-md">
        {paying && <PayForm key={paying.participantId} row={paying} pending={markPaid.isPending} onSubmit={handlePay} onCancel={() => setPaying(null)} />}
      </Modal>
    </>
  );
}

function PayForm({ row, pending, onSubmit, onCancel }) {
  const { active, byId, defaultId } = useAccountData();
  const billAccount = byId.get(row.account);
  const [account, setAccount] = useState(billAccount && !billAccount.archived ? billAccount._id : defaultId);
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
          <p className="font-semibold text-white">{row.name} paid you back</p>
          <p className="truncate text-xs text-white/45">for {row.description || row.category}</p>
        </div>
        <p className="num text-xl font-semibold text-neon">{money(row.amount)}</p>
      </div>

      {active.length > 0 && (
        <div>
          <span className="label">Received in</span>
          <AccountPicker accounts={active} value={account} onChange={setAccount} />
        </div>
      )}

      <div>
        <label className="label" htmlFor="pay-date">Date received</label>
        <input id="pay-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending && <Spinner className="text-black" />}
          <CircleCheck size={15} /> Add to balance
        </button>
      </div>
    </form>
  );
}
