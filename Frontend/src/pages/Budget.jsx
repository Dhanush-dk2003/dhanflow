import { useState } from 'react';
import { motion } from 'motion/react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2, WandSparkles } from 'lucide-react';
import { useBudget, useCategories, useResetBudget, useSaveBudget } from '../hooks/queries';
import { usePalette } from '../context/UIContext';
import { DEFAULT_CATEGORIES, SPLIT_REPAYMENT } from '../lib/constants';
import { currentMonthKey, money, moneyWhole, monthTitle, shiftMonthKey } from '../lib/format';
import { Card, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, ProgressBar, RingGauge, Spinner } from '../components/ui';
import { useConfirm } from '../components/ConfirmDialog';

const toDraft = (status) => ({
  total: status?.budget?.total ? String(status.budget.total) : '',
  categories: (status?.budget?.categories ?? []).map((c) => ({ category: c.category, limit: String(c.limit) })),
});

function BudgetEditor({ status, month, onDone }) {
  const [draft, setDraft] = useState(() => toDraft(status));
  const [error, setError] = useState('');
  const save = useSaveBudget();
  const { data: categories = DEFAULT_CATEGORIES } = useCategories();
  const options = categories.debit.filter((c) => c !== SPLIT_REPAYMENT && !draft.categories.some((d) => d.category === c));

  const categorySum = draft.categories.reduce((s, c) => s + (Number(c.limit) || 0), 0);

  const applySuggestion = () => {
    const s = status.suggestion;
    if (!s) return;
    setDraft({ total: String(s.total), categories: s.categories.map((c) => ({ category: c.category, limit: String(c.limit) })) });
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    const total = Number(draft.total);
    if (!(total > 0)) return setError('Set a monthly budget greater than 0');
    const rows = draft.categories.filter((c) => c.category.trim());
    if (rows.some((c) => !(Number(c.limit) >= 0) || c.limit === '')) return setError('Every category needs a limit');
    save.mutate(
      { month, data: { total, categories: rows.map((c) => ({ category: c.category.trim(), limit: Number(c.limit) })) } },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {status.suggestion && (
        <button
          type="button"
          onClick={applySuggestion}
          className="flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-orchid/25 bg-orchid/[0.08] p-4 text-left transition hover:bg-orchid/[0.12]"
        >
          <WandSparkles size={18} className="mt-0.5 shrink-0 text-orchid" />
          <div>
            <p className="text-sm font-semibold text-white">Use my suggestion: {moneyWhole(status.suggestion.total)}/month</p>
            <p className="mt-0.5 text-xs text-white/50">
              Based on your average spending over the last {status.suggestion.basedOnMonths}{' '}
              {status.suggestion.basedOnMonths === 1 ? 'month' : 'months'}, category by category.
            </p>
          </div>
        </button>
      )}

      <div>
        <label className="label" htmlFor="b-total">Monthly spending limit</label>
        <div className="relative">
          <span className="num absolute top-1/2 left-4 -translate-y-1/2 text-lg text-white/40">₹</span>
          <input
            id="b-total"
            inputMode="decimal"
            className="input num py-3 pl-9 text-xl font-semibold"
            placeholder="25000"
            value={draft.total}
            onChange={(e) => setDraft({ ...draft, total: e.target.value })}
          />
        </div>
        <p className="mt-1.5 text-xs text-white/40">
          Counts only your own share, so split bills your friends pay back don't eat into it.
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label mb-0">Category limits (optional)</span>
          {categorySum > 0 && (
            <span className={`num text-xs ${categorySum > Number(draft.total) ? 'text-amber-300' : 'text-white/40'}`}>
              {money(categorySum)} allocated
            </span>
          )}
        </div>
        <div className="space-y-2">
          {draft.categories.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input"
                list="budget-cats"
                placeholder="Category"
                value={c.category}
                onChange={(e) =>
                  setDraft({ ...draft, categories: draft.categories.map((x, idx) => (idx === i ? { ...x, category: e.target.value } : x)) })
                }
              />
              <input
                inputMode="decimal"
                className="input num w-32 shrink-0"
                placeholder="₹ limit"
                value={c.limit}
                onChange={(e) =>
                  setDraft({ ...draft, categories: draft.categories.map((x, idx) => (idx === i ? { ...x, limit: e.target.value } : x)) })
                }
              />
              <button
                type="button"
                className="btn-icon hover:text-rose-300"
                onClick={() => setDraft({ ...draft, categories: draft.categories.filter((_, idx) => idx !== i) })}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <datalist id="budget-cats">
            {options.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {options.slice(0, 6).map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              onClick={() => setDraft({ ...draft, categories: [...draft.categories, { category: c, limit: '' }] })}
            >
              <Plus size={12} /> {c}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Spinner className="text-black" />} Save budget
        </button>
      </div>
    </form>
  );
}

export default function Budget() {
  const [month, setMonth] = useState(currentMonthKey());
  const [editing, setEditing] = useState(false);
  const { data: status, isLoading, error } = useBudget(month);
  const reset = useResetBudget();
  const confirm = useConfirm();
  const palette = usePalette();
  const isCurrent = month === currentMonthKey();

  const budget = status?.budget;
  const pct = status?.percent ?? 0;
  const ringColor = pct > 100 ? palette.rose : pct >= 80 ? palette.amber : palette.neon;

  const handleReset = () =>
    confirm({
      tone: 'danger',
      title: `Remove the ${monthTitle(month)} budget?`,
      message: "This month will fall back to your previous month's budget, if there is one.",
      confirmLabel: 'Remove budget',
      action: () => reset.mutateAsync(month),
    });

  return (
    <>
      <PageHeader eyebrow="Plan" title="Monthly budget" subtitle="Set a limit for your own spending. I'll track your pace and warn you at 80% and 100%.">
        <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
          <button className="btn-icon" onClick={() => setMonth((m) => shiftMonthKey(m, -1))} title="Previous month">
            <ChevronLeft size={18} />
          </button>
          <span className="flex min-w-36 items-center justify-center gap-2 text-sm font-semibold text-white">
            <CalendarDays size={14} className="text-neon" /> {monthTitle(month)}
          </span>
          <button className="btn-icon" onClick={() => setMonth((m) => shiftMonthKey(m, 1))} title="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
        {!isCurrent && (
          <button className="btn-ghost" onClick={() => setMonth(currentMonthKey())}>
            Today
          </button>
        )}
      </PageHeader>

      {error && <ErrorState error={error} />}
      {isLoading && <LoadingBlock />}

      {status && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="flex flex-col items-center p-6 text-center">
            {budget ? (
              <>
                <RingGauge value={Math.min(pct, 100)} size={200} stroke={16} color={ringColor}>
                  <span className="num text-4xl font-bold text-white">{Math.round(pct)}%</span>
                  <span className="text-xs text-white/45">used</span>
                </RingGauge>
                <p className="mt-5 text-sm text-white/50">
                  <span className="num font-semibold text-white">{money(status.spent)}</span> of{' '}
                  <span className="num font-semibold text-white">{money(budget.total)}</span>
                </p>
                <p className={`num mt-1 text-lg font-semibold ${status.remaining < 0 ? 'text-rose-300' : 'text-neon'}`}>
                  {status.remaining < 0 ? `${money(-status.remaining)} over` : `${money(status.remaining)} left`}
                </p>
                {budget.inherited && (
                  <p className="mt-3 rounded-full bg-white/[0.05] px-3 py-1 text-[11px] text-white/45">
                    Carried over from {monthTitle(budget.sourceMonth)}
                  </p>
                )}
                <div className="mt-5 flex gap-2">
                  <button className="btn-primary" onClick={() => setEditing(true)}>
                    {budget.inherited ? 'Customise this month' : 'Edit budget'}
                  </button>
                  {!budget.inherited && (
                    <button className="btn-icon" title="Reset this month" onClick={handleReset}>
                      <RotateCcw size={16} />
                    </button>
                  )}
                </div>
              </>
            ) : (
              <EmptyState
                title="No budget for this month"
                message={
                  status.suggestion
                    ? `Based on your history, around ${moneyWhole(status.suggestion.total)} looks realistic.`
                    : 'Set a limit and I will start tracking your pace.'
                }
                action={
                  <button className="btn-primary" onClick={() => setEditing(true)}>
                    <Plus size={16} /> Set budget
                  </button>
                }
              />
            )}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
            {[
              {
                label: 'Safe to spend per day',
                value: status.safeDaily != null ? moneyWhole(status.safeDaily) : '—',
                hint: status.daysLeft ? `for the next ${status.daysLeft} days` : 'Month is over',
                color: 'text-neon',
              },
              {
                label: 'Projected month end',
                value: moneyWhole(status.projected),
                hint: budget
                  ? status.projected > budget.total
                    ? `${moneyWhole(status.projected - budget.total)} over budget at this pace`
                    : 'Within budget at this pace'
                  : 'Based on your daily pace',
                color: budget && status.projected > budget.total ? 'text-rose-300' : 'text-white',
              },
              {
                label: 'Spent so far',
                value: moneyWhole(status.spent),
                hint: `${status.daysElapsed} of ${status.daysInMonth} days`,
                color: 'text-white',
              },
              {
                label: 'Daily average',
                value: status.daysElapsed ? moneyWhole(status.spent / status.daysElapsed) : '—',
                hint: 'Your share, per day',
                color: 'text-aqua',
              },
            ].map((s, i) => (
              <Card key={s.label} delay={0.05 * i} className="p-5">
                <p className="eyebrow">{s.label}</p>
                <p className={`num mt-3 text-3xl font-semibold ${s.color}`}>{s.value}</p>
                <p className="mt-1.5 text-xs text-white/40">{s.hint}</p>
              </Card>
            ))}
          </div>

          <Card delay={0.1} className="p-5 lg:col-span-3">
            <h2 className="mb-4 font-display text-lg font-semibold text-white">By category</h2>
            {status.categories.length ? (
              <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
                {status.categories.map((c, i) => (
                  <motion.div key={c.category} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <p className="font-medium text-white">
                        {c.category}
                        {c.fixed && <span className="ml-2 text-[10px] font-normal tracking-wide text-white/35 uppercase">fixed</span>}
                      </p>
                      <p className="num text-sm text-white/60">
                        <span className="font-semibold text-white">{moneyWhole(c.spent)}</span>
                        {c.limit != null && <> / {moneyWhole(c.limit)}</>}
                      </p>
                    </div>
                    {c.limit != null ? (
                      <>
                        <ProgressBar percent={c.percent} />
                        <p className={`mt-1 text-[11px] ${c.remaining < 0 ? 'text-rose-300' : 'text-white/40'}`}>
                          {c.remaining < 0 ? `${money(-c.remaining)} over` : `${money(c.remaining)} left`}
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-white/35">No limit set</p>
                    )}
                  </motion.div>
                ))}
              </div>
            ) : (
              <EmptyState title="No spending this month yet" />
            )}
          </Card>
        </div>
      )}

      <Modal open={editing && !!status} title={`Budget for ${monthTitle(month)}`} onClose={() => setEditing(false)}>
        <BudgetEditor status={status} month={month} onDone={() => setEditing(false)} />
      </Modal>
    </>
  );
}
