import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Divide, HandCoins, Landmark, Lock, Mic, Square, Trash2, UserPlus } from 'lucide-react';
import { useCategories, usePeople, useSaveTransaction } from '../hooks/queries';
import { speechStatus, useSpeech } from '../hooks/useSpeech';
import { useUI } from '../context/UIContext';
import { parseSpokenEntry } from '../lib/voiceEntry';
import { DEFAULT_CATEGORIES, PAYMENT_METHODS, SPLIT_REPAYMENT, TRANSFER } from '../lib/constants';
import { isExpression, tryEvaluate } from '../lib/calc';
import { localISODate, money, moneyExact, round2, toInputDate } from '../lib/format';
import { AccountPicker, useAccountData } from './accounts';
import AddOwnCategory from './AddOwnCategory';
import { Modal, Spinner } from './ui';
import { VoiceNotePlayer } from './VoiceNote';

const emptyForm = (prefill) => ({
  type: 'debit',
  amount: '',
  category: 'Food',
  description: '',
  date: localISODate(),
  paymentMethod: 'upi',
  account: '',
  toAccount: '',
  isSplit: false,
  participants: [],
  paidBy: 'me',
  owedTo: '',
  ...prefill,
});

const fromTransaction = (t) => ({
  type: t.type,
  amount: String(t.amount),
  category: t.category,
  description: t.description ?? '',
  date: toInputDate(t.date),
  paymentMethod: t.paymentMethod ?? 'upi',
  account: t.account ?? '',
  toAccount: t.toAccount ?? '',
  isSplit: t.participants?.length > 0,
  participants: (t.participants ?? []).map((p) => ({
    _id: p._id,
    name: p.name,
    amount: String(p.amount),
    isPaid: p.isPaid,
  })),
  paidBy: t.owedTo ? 'other' : 'me',
  owedTo: t.owedTo?.name ?? '',
});

const amountOf = (v) => tryEvaluate(v) ?? 0;

const FIELD_NAMES = {
  amount: 'amount',
  type: 'type',
  category: 'category',
  date: 'date',
  description: 'description',
  paymentMethod: 'payment',
  participants: 'split',
  owedTo: 'who paid',
};

function heardSummary({ text, fields }, autoFill) {
  if (!text) return "Couldn't make out the words, but the voice note is kept.";
  if (!autoFill) return 'Voice note recorded. It will be saved with this entry.';
  return fields.length ? `Filled ${fields.join(', ')}. Check and save; the voice note is saved too.` : "Couldn't pick out the details, but the voice note is kept.";
}

function VoiceBar({ categories, autoFill, onFill, onRecorded }) {
  const [heard, setHeard] = useState(null);
  const speech = useSpeech({
    onResult: (text, recording) => {
      if (recording) onRecorded({ ...recording, transcript: text });
      const patch = autoFill && text ? parseSpokenEntry(text, categories) : {};
      setHeard({ text, fields: Object.keys(patch).filter((k) => FIELD_NAMES[k]).map((k) => FIELD_NAMES[k]) });
      if (autoFill && text) onFill(patch);
    },
  });
  if (!speech.supported) return null;
  const status = speechStatus(speech, autoFill ? 'Listening… e.g. "spent 450 on petrol yesterday in cash"' : 'Listening…');
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
      <button
        type="button"
        onClick={speech.toggle}
        disabled={Boolean(speech.transcribing)}
        className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl transition disabled:cursor-wait ${
          speech.listening ? 'animate-pulse bg-rose-500 text-white' : 'bg-neon/15 text-neon hover:bg-neon/25'
        }`}
        title={speech.listening ? 'Stop recording' : autoFill ? 'Speak the entry' : 'Record a voice note'}
        aria-label={speech.listening ? 'Stop recording' : autoFill ? 'Speak the entry' : 'Record a voice note'}
      >
        {speech.transcribing ? <Spinner /> : speech.listening ? <Square size={14} /> : <Mic size={16} />}
      </button>
      <p className="min-w-0 flex-1 text-xs text-white/50">
        {status ? (
          <span className="text-white/85">{status}</span>
        ) : heard ? (
          <>
            {heard.text && <span className="text-white/80">“{heard.text}”</span>}
            <span className="block text-[11px] text-white/40">{heardSummary(heard, autoFill)}</span>
          </>
        ) : autoFill ? (
          'Tap the mic and say it: "paid 1200 for dinner, split with Ravi and Anu". The recording is saved with the entry.'
        ) : (
          'Tap the mic to record a voice note for this entry'
        )}
      </p>
    </div>
  );
}

function TransactionForm({ initial, prefill, onDone }) {
  const [form, setForm] = useState(() => (initial ? fromTransaction(initial) : emptyForm(prefill)));
  const [error, setError] = useState('');
  const [voice, setVoice] = useState(null);
  const [removeSavedVoice, setRemoveSavedVoice] = useState(false);
  const savedVoice = initial?.voiceNote && !removeSavedVoice ? initial.voiceNote : null;
  const { data: categories = DEFAULT_CATEGORIES } = useCategories();
  const { active: activeAccounts, byId, defaultId } = useAccountData();
  const save = useSaveTransaction();

  const { data: people } = usePeople();
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const hasPaidParticipants = form.participants.some((p) => p.isPaid);
  const categoryOptions = (categories[form.type] ?? []).filter((c) => c !== SPLIT_REPAYMENT);
  const customCategories = categories.custom?.[form.type] ?? [];
  const quickCategories = categoryOptions.slice(0, Math.max(8, customCategories.length + 5));
  const isTransfer = form.type === 'transfer';
  const friendPaid = form.type === 'debit' && form.paidBy === 'other';
  const paidBack = Boolean(initial?.owedTo?.isPaid);
  const knownName = (name) => people?.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())?.name ?? name.trim();

  // An old entry may sit on an archived account; keep it selectable so the edit doesn't silently move it.
  const pickable = useMemo(() => {
    const extra = [form.account, form.toAccount].map((id) => byId.get(id)).filter((a) => a?.archived);
    return [...activeAccounts, ...extra.filter((a, i) => extra.indexOf(a) === i)];
  }, [activeAccounts, byId, form.account, form.toAccount]);

  useEffect(() => {
    if (!initial && !form.account && defaultId) setForm((f) => (f.account ? f : { ...f, account: defaultId }));
  }, [initial, form.account, defaultId]);

  const chooseAccount = (account) => {
    const type = byId.get(account)?.type;
    const patch = { account };
    if (type === 'cash') patch.paymentMethod = 'cash';
    else if (form.paymentMethod === 'cash') patch.paymentMethod = type === 'card' ? 'card' : 'upi';
    if (account === form.toAccount) patch.toAccount = '';
    set(patch);
  };

  const amount = round2(amountOf(form.amount));
  const showAmountPreview = isExpression(form.amount) && tryEvaluate(form.amount) != null;
  const splitTotal = useMemo(
    () => (form.isSplit ? round2(form.participants.reduce((s, p) => s + amountOf(p.amount), 0)) : 0),
    [form.isSplit, form.participants],
  );
  const myShare = round2(amount - splitTotal);

  const setType = (type) => {
    if (type === 'transfer') {
      const to = form.toAccount && form.toAccount !== form.account ? form.toAccount : activeAccounts.find((a) => a._id !== form.account)?._id;
      return set({ type, category: TRANSFER, isSplit: false, participants: [], paymentMethod: 'bank', toAccount: to ?? '' });
    }
    set({
      type,
      category: DEFAULT_CATEGORIES[type][0],
      ...(type === 'credit' ? { isSplit: false, participants: [], paidBy: 'me' } : {}),
    });
  };

  const setPaidBy = (paidBy) => set(paidBy === 'other' ? { paidBy, isSplit: false, participants: [] } : { paidBy });

  const toggleSplit = () => {
    if (form.isSplit) set({ isSplit: false, participants: form.participants.filter((p) => p.isPaid) });
    else set({ isSplit: true, participants: form.participants.length ? form.participants : [{ name: '', amount: '' }] });
  };

  const updateParticipant = (index, patch) =>
    set({ participants: form.participants.map((p, i) => (i === index ? { ...p, ...patch } : p)) });

  const splitEqually = () => {
    const editable = form.participants.filter((p) => !p.isPaid);
    if (!amount || !editable.length) return;
    const locked = form.participants.filter((p) => p.isPaid).reduce((s, p) => s + Number(p.amount), 0);
    const share = round2((amount - locked) / (editable.length + 1));
    set({ participants: form.participants.map((p) => (p.isPaid ? p : { ...p, amount: String(share) })) });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!(amount > 0)) return setError('Enter an amount greater than 0 (you can type maths like 1200+350)');
    if (isTransfer) {
      if (!form.account || !form.toAccount) return setError('Pick where the money leaves and where it goes');
      if (form.account === form.toAccount) return setError('Choose two different accounts');
    }
    if (!form.category.trim()) return setError('Category is required');
    if (friendPaid && !form.owedTo.trim()) return setError('Who paid for it? Enter their name');

    const participants = form.isSplit && !friendPaid ? form.participants : [];
    if (participants.some((p) => !p.name.trim() || !(amountOf(p.amount) > 0))) {
      return setError('Every person in the split needs a name and an amount greater than 0');
    }
    if (splitTotal - amount > 0.001) return setError("Split total can't be more than the amount");

    save.mutate(
      {
        id: initial?._id,
        data: {
          type: form.type,
          amount,
          category: isTransfer ? TRANSFER : form.category.trim(),
          description: form.description.trim(),
          date: form.date,
          paymentMethod: form.paymentMethod,
          account: form.account || null,
          ...(isTransfer ? { toAccount: form.toAccount } : {}),
          participants: participants.map(({ _id, name, amount: a }) => ({
            ...(_id ? { _id } : {}),
            name: name.trim(),
            amount: round2(amountOf(a)),
          })),
          ...(friendPaid ? { owedTo: { name: knownName(form.owedTo) } } : initial?.owedTo ? { owedTo: null } : {}),
        },
        voice: voice ?? (initial?.voiceNote && removeSavedVoice ? { remove: true } : undefined),
      },
      { onSuccess: onDone },
    );
  };

  const isDebit = form.type === 'debit';
  const canTransfer = pickable.length >= 2;

  const fillFromVoice = (patch) => {
    if (patch.type && patch.type !== form.type) {
      setType(patch.type);
      if (patch.type === 'credit') delete patch.isSplit;
    }
    const cashAccount = activeAccounts.find((a) => a.type === 'cash');
    if (patch.paymentMethod === 'cash' && cashAccount) patch.account = cashAccount._id;
    set(patch);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <VoiceBar categories={categories} autoFill={!initial} onFill={fillFromVoice} onRecorded={setVoice} />
      {voice ? (
        <VoiceNotePlayer
          blob={voice.blob}
          duration={voice.duration}
          transcript={voice.transcript}
          note={savedVoice ? 'New voice note, replaces the old one' : 'Voice note, saved with this entry'}
          onRemove={() => setVoice(null)}
        />
      ) : (
        savedVoice && (
          <VoiceNotePlayer
            transactionId={initial._id}
            duration={savedVoice.duration}
            transcript={savedVoice.transcript}
            onRemove={() => setRemoveSavedVoice(true)}
          />
        )
      )}
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1">
        {[
          { type: 'debit', label: 'Money out', icon: ArrowUpRight, active: 'bg-rose-400 text-black' },
          { type: 'credit', label: 'Money in', icon: ArrowDownLeft, active: 'bg-neon text-black' },
          { type: 'transfer', label: 'Transfer', icon: ArrowLeftRight, active: 'bg-aqua text-black' },
        ].map(({ type, label, icon: Icon, active }) => (
          <button
            key={type}
            type="button"
            disabled={(hasPaidParticipants && type !== 'debit') || (type === 'transfer' && !canTransfer)}
            title={type === 'transfer' && !canTransfer ? 'Add at least two accounts to move money between them' : undefined}
            onClick={() => form.type !== type && setType(type)}
            className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${
              form.type === type ? active : 'text-white/50 hover:text-white'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-5 py-4 text-center">
        <label className="eyebrow" htmlFor="amount">{friendPaid ? 'Your share' : 'Amount'}</label>
        <div className="mt-1 flex items-center justify-center gap-1">
          <span className={`num text-3xl ${isDebit ? 'text-rose-300' : isTransfer ? 'text-aqua' : 'text-neon'}`}>₹</span>
          <input
            id="amount"
            inputMode="decimal"
            autoFocus
            autoComplete="off"
            className="num w-full max-w-[260px] bg-transparent text-center text-4xl font-semibold text-white outline-none placeholder:text-white/15"
            placeholder="0"
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
            onBlur={() => showAmountPreview && set({ amount: String(amount) })}
          />
        </div>
        <p className="mt-1 h-4 text-xs text-white/40">
          {showAmountPreview ? <span className="text-neon">= {moneyExact(amount)}</span> : 'Tip: type maths like 1200+350 or 2400*18%'}
        </p>
      </div>

      {pickable.length ? (
        isTransfer ? (
          <div className="space-y-3 rounded-2xl border border-aqua/20 bg-aqua/[0.04] p-4">
            <div>
              <span className="label">From</span>
              <AccountPicker accounts={pickable} value={form.account} onChange={chooseAccount} />
            </div>
            <div>
              <span className="label">To</span>
              <AccountPicker accounts={pickable} value={form.toAccount} exclude={form.account} onChange={(toAccount) => set({ toAccount })} />
            </div>
            <p className="text-xs text-white/40">Moving your own money doesn't count as income or spending, only the account balances change.</p>
          </div>
        ) : (
          <div>
            <span className="label">{friendPaid ? (paidBack ? 'Paid back from' : 'Will pay back from') : isDebit ? 'Paid from' : 'Received in'}</span>
            <AccountPicker accounts={pickable} value={form.account} onChange={chooseAccount} />
          </div>
        )
      ) : (
        <Link
          to="/accounts"
          onClick={onDone}
          className="flex items-center gap-3 rounded-2xl border border-dashed border-white/15 px-4 py-3 text-xs text-white/50 transition hover:border-neon/40 hover:text-white"
        >
          <Landmark size={16} className="shrink-0 text-aqua" />
          Have more than one bank account? Add your accounts to see each balance separately.
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {!isTransfer && (
          <div>
            <label className="label" htmlFor="category">Category</label>
            <input
              id="category"
              list="category-options"
              className="input"
              placeholder="Pick or type"
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
            />
            <datalist id="category-options">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        )}
        <div>
          <label className="label" htmlFor="date">Date</label>
          <input id="date" type="date" className="input" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
      </div>

      {!isTransfer && (
        <div className="flex flex-wrap gap-1.5">
          {quickCategories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set({ category: c })}
              className={`chip ${form.category === c ? 'chip-active' : ''}`}
            >
              {c}
            </button>
          ))}
          <AddOwnCategory type={form.type} known={categoryOptions} onAdded={(category) => set({ category })} />
        </div>
      )}

      <div className={`grid gap-4 ${isTransfer ? '' : 'sm:grid-cols-[1fr_auto]'}`}>
        <div>
          <label className="label" htmlFor="description">Note</label>
          <input
            id="description"
            className="input"
            maxLength={200}
            placeholder={isTransfer ? 'e.g. ATM withdrawal' : isDebit ? 'e.g. Dinner at Barbeque Nation' : 'e.g. October salary'}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </div>
        {!isTransfer && (
          <div>
            <span className="label">Paid via</span>
            <div className="flex gap-1">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set({ paymentMethod: m.value })}
                  className={`chip px-2.5 py-2 ${form.paymentMethod === m.value ? 'chip-active' : ''}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {isDebit && (
        <div className={`rounded-2xl border transition ${friendPaid ? 'border-amber-300/30 bg-amber-300/[0.05]' : 'border-white/[0.08]'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Who paid?</p>
              <p className="text-xs text-white/45">
                {friendPaid ? 'A friend paid; you owe them your share' : 'You paid the bill'}
              </p>
            </div>
            <div className="flex gap-1">
              <button type="button" className={`chip ${!friendPaid ? 'chip-active' : ''}`} onClick={() => setPaidBy('me')}>
                I paid
              </button>
              <button
                type="button"
                className={`chip ${friendPaid ? 'chip-active' : ''}`}
                disabled={hasPaidParticipants}
                title={hasPaidParticipants ? 'Friends already paid you back for this split' : undefined}
                onClick={() => setPaidBy('other')}
              >
                <HandCoins size={13} /> A friend paid
              </button>
            </div>
          </div>
          {friendPaid && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-2 px-4 pb-4">
              <input
                className="input"
                list="people-options"
                placeholder="Who paid? e.g. Ram"
                maxLength={60}
                value={form.owedTo}
                onChange={(e) => set({ owedTo: e.target.value })}
              />
              <datalist id="people-options">
                {(people ?? []).map((p) => (
                  <option key={p.name} value={p.name} />
                ))}
              </datalist>
              <p className="text-xs text-white/45">
                {paidBack
                  ? `Already paid back to ${initial.owedTo.name}. Undo it from Collect if needed.`
                  : `Enter only your share. It counts in your spending now, but leaves your account only when you pay ${
                      form.owedTo.trim() || 'them'
                    } back from Collect, where it's netted against what they owe you.`}
              </p>
            </motion.div>
          )}
        </div>
      )}

      {isDebit && !friendPaid && (
        <div className={`rounded-2xl border transition ${form.isSplit ? 'border-orchid/30 bg-orchid/[0.05]' : 'border-white/[0.08]'}`}>
          <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Split with friends</p>
              <p className="text-xs text-white/45">I'll track who owes you and remind you to collect</p>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5 accent-[#a78bfa]"
              checked={form.isSplit}
              disabled={hasPaidParticipants}
              onChange={toggleSplit}
            />
          </label>

          {form.isSplit && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-2.5 px-4 pb-4">
              {form.participants.map((p, i) => (
                <div key={p._id ?? `new-${i}`} className="flex items-center gap-2">
                  <input
                    className="input"
                    placeholder="Name"
                    value={p.name}
                    disabled={p.isPaid}
                    onChange={(e) => updateParticipant(i, { name: e.target.value })}
                  />
                  <input
                    inputMode="decimal"
                    className="input w-28 shrink-0"
                    placeholder="₹"
                    value={p.amount}
                    disabled={p.isPaid}
                    onChange={(e) => updateParticipant(i, { amount: e.target.value })}
                  />
                  {p.isPaid ? (
                    <span className="btn-icon text-neon" title="Already paid back, locked">
                      <Lock size={15} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn-icon hover:text-rose-300"
                      onClick={() => set({ participants: form.participants.filter((_, idx) => idx !== i) })}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="chip"
                  onClick={() => set({ participants: [...form.participants, { name: '', amount: '' }] })}
                >
                  <UserPlus size={13} /> Add person
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={splitEqually}
                  disabled={!amount || !form.participants.some((p) => !p.isPaid)}
                >
                  <Divide size={13} /> Split equally incl. me
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-xl bg-black/25 px-3 py-2.5">
                  <p className="text-[11px] text-white/40">Friends owe you</p>
                  <p className="num font-semibold text-orchid">{money(splitTotal)}</p>
                </div>
                <div className="rounded-xl bg-black/25 px-3 py-2.5">
                  <p className="text-[11px] text-white/40">Your share</p>
                  <p className={`num font-semibold ${myShare < 0 ? 'text-rose-300' : 'text-white'}`}>{money(myShare)}</p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {error && <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Spinner className="text-black" />}
          {initial ? 'Save changes' : isTransfer ? 'Move money' : isDebit ? 'Add expense' : 'Add income'}
        </button>
      </div>
    </form>
  );
}

export default function TransactionModal() {
  const { txnModal, closeTransaction } = useUI();
  const { open, transaction, prefill } = txnModal;
  return (
    <Modal open={open} title={transaction ? 'Edit transaction' : 'New transaction'} onClose={closeTransaction}>
      <TransactionForm key={transaction?._id ?? 'new'} initial={transaction} prefill={prefill} onDone={closeTransaction} />
    </Modal>
  );
}
