import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRight,
  Calculator as CalculatorIcon,
  Flame,
  Gauge,
  HandCoins,
  PiggyBank,
  Plus,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useInsights, usePeople, useSettings, useSummary } from '../hooks/queries';
import { usePalette, useUI } from '../context/UIContext';
import { BRAND, PERIODS, TONES } from '../lib/constants';
import { greeting, maskAmounts, money, moneyCompact, moneyWhole } from '../lib/format';
import TransactionList from '../components/TransactionList';
import { AccountIcon, useAccountData } from '../components/accounts';
import { AnimatedNumber, Avatar, Card, EmptyState, ErrorState, LoadingBlock, ProgressBar, RingGauge, Segmented, StatTile } from '../components/ui';

const INSIGHT_ICONS = {
  target: Target,
  flame: Flame,
  gauge: Gauge,
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  sparkles: Sparkles,
  'piggy-bank': PiggyBank,
  'hand-coins': HandCoins,
};

const scoreColor = (v, p) => (v >= 80 ? p.neon : v >= 60 ? p.aqua : v >= 40 ? p.amber : p.rose);

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-solid rounded-2xl px-3 py-2 text-xs">
      {label && <p className="mb-1 text-white/50">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center gap-2 text-white">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color ?? p.payload?.fill }} />
          {p.name}: <span className="num font-semibold">{money(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function AdvisorHero({ insights, name }) {
  const { openTransaction, toggleCalculator } = useUI();
  const palette = usePalette();
  const score = insights?.score;
  const stats = insights?.stats;

  return (
    <Card className="relative overflow-hidden p-6 sm:p-8 lg:col-span-2">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-neon/10 blur-3xl" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2">
            <Sparkles size={12} className="text-neon" /> Your advisor
          </p>
          <h1 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-white sm:text-[2.6rem]">
            {greeting()}, <span className="text-gradient">{name}</span>
          </h1>
          <p className="mt-3 max-w-md text-base text-white/60">{insights?.headline ?? 'Crunching your numbers…'}</p>

          {stats && (
            <div className="mt-5 flex flex-wrap gap-2">
              {stats.safeDaily != null && (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70">
                  Safe to spend <span className="num font-semibold text-neon">{moneyWhole(stats.safeDaily)}</span>/day
                </span>
              )}
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70">
                <span className="num font-semibold text-white">{stats.daysLeft}</span> days left this month
              </span>
              {stats.savingsRate != null && (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70">
                  Saving <span className="num font-semibold text-aqua">{Math.round(stats.savingsRate)}%</span> of income
                </span>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => openTransaction()}>
              <Plus size={16} /> Add transaction <span className="kbd border-black/20 bg-black/10 text-black/60">N</span>
            </button>
            <button className="btn-secondary" onClick={toggleCalculator}>
              <CalculatorIcon size={16} /> Calculator <span className="kbd">C</span>
            </button>
          </div>
        </div>

        {score && (
          <div className="flex flex-col items-center gap-2 self-center">
            <RingGauge value={score.value} size={150} stroke={12} color={scoreColor(score.value, palette)}>
              <AnimatedNumber value={score.value} format={(n) => Math.round(n)} className="text-4xl font-bold text-white" />
              <span className="text-[11px] text-white/45">/ 100</span>
            </RingGauge>
            <p className="eyebrow">Money score</p>
            <p className="text-sm font-semibold" style={{ color: scoreColor(score.value, palette) }}>
              {score.label}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function AccountBalances({ accounts }) {
  const shown = accounts.slice(0, 4);
  return (
    <div className="mt-5 space-y-1">
      {shown.map((a) => (
        <Link
          key={a._id}
          to={`/transactions?account=${a._id}`}
          className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition hover:bg-white/[0.05]"
        >
          <AccountIcon account={a} size="h-7 w-7" iconSize={13} />
          <span className="min-w-0 flex-1 truncate text-white/75">{a.name}</span>
          <span className={`num font-semibold ${a.balance < 0 ? 'text-rose-300' : 'text-white'}`}>{moneyWhole(a.balance)}</span>
        </Link>
      ))}
      <Link to="/accounts" className="block px-2 pt-1 text-xs font-medium text-white/45 hover:text-neon">
        {accounts.length > shown.length ? `+${accounts.length - shown.length} more · ` : ''}Manage accounts →
      </Link>
    </div>
  );
}

function BalanceCard({ summary }) {
  const { active: accounts } = useAccountData();
  return (
    <Card delay={0.05} className="relative flex flex-col overflow-hidden p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-orchid/20 via-transparent to-aqua/10" />
      <Wallet className="absolute -right-6 -bottom-6 text-white/[0.04]" size={160} />
      <div className="relative flex flex-1 flex-col">
        <p className="eyebrow">Current balance</p>
        <p className={`mt-3 text-4xl font-bold ${summary.balance < 0 ? 'text-rose-300' : 'text-white'}`}>
          <AnimatedNumber value={summary.balance} />
        </p>
        {accounts.length > 0 ? (
          <AccountBalances accounts={accounts} />
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-black/20 px-3 py-2.5">
              <p className="text-[11px] text-white/40">Money in</p>
              <p className="num font-semibold text-neon">{moneyCompact(summary.totals.credit)}</p>
            </div>
            <div className="rounded-2xl bg-black/20 px-3 py-2.5">
              <p className="text-[11px] text-white/40">Money out</p>
              <p className="num font-semibold text-rose-300">{moneyCompact(summary.totals.debit)}</p>
            </div>
          </div>
        )}
        {summary.pending.total > 0 && (
          <div className="mt-auto pt-5">
            <Link
              to="/splits"
              className="group flex items-center justify-between gap-2 rounded-2xl border border-orchid/25 bg-orchid/10 px-3.5 py-2.5 text-sm text-orchid transition hover:bg-orchid/15"
            >
              <span>
                <span className="num font-semibold">{moneyWhole(summary.pending.total)}</span> with {summary.pending.people}{' '}
                {summary.pending.people === 1 ? 'friend' : 'friends'}
              </span>
              <ArrowRight size={15} className="transition group-hover:translate-x-1" />
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}

function InsightFeed({ insights }) {
  if (!insights?.length) return null;
  return (
    <Card delay={0.1} className="p-5 lg:col-span-2">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-white">What I noticed</h2>
        <span className="eyebrow">{insights.length} insights</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {insights.map((ins, i) => {
          const Icon = INSIGHT_ICONS[ins.icon] ?? Sparkles;
          const tone = TONES[ins.tone] ?? TONES.info;
          return (
            <motion.div
              key={ins.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.06 }}
              whileHover={{ y: -3 }}
              className={`flex gap-3 rounded-2xl border ${tone.border} ${tone.bg} p-4`}
            >
              <div className={`mt-0.5 shrink-0 ${tone.text}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{maskAmounts(ins.title)}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/55">{maskAmounts(ins.message)}</p>
                {ins.action && (
                  <Link to={ins.action.to} className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${tone.text} hover:underline`}>
                    {ins.action.label} <ArrowRight size={12} />
                  </Link>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}

function BudgetPulse({ insights }) {
  const stats = insights?.stats;
  const palette = usePalette();
  if (!stats) return null;
  const pct = stats.budget ? (stats.spent / stats.budget) * 100 : 0;
  const color = pct > 100 ? palette.rose : pct >= 80 ? palette.amber : palette.neon;

  return (
    <Card delay={0.15} className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-white">This month</h2>
        <Link to="/budget" className="text-xs font-medium text-white/45 hover:text-neon">
          {stats.budget ? 'Edit budget' : 'Set budget'} →
        </Link>
      </div>
      {stats.budget ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-4">
          <RingGauge value={Math.min(pct, 100)} size={170} stroke={14} color={color}>
            <span className="num text-3xl font-bold text-white">{Math.round(pct)}%</span>
            <span className="text-[11px] text-white/45">of budget used</span>
          </RingGauge>
          <div className="grid w-full grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl bg-white/[0.03] py-2">
              <p className="text-[11px] text-white/40">Spent</p>
              <p className="num text-sm font-semibold text-white">{moneyWhole(stats.spent)}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.03] py-2">
              <p className="text-[11px] text-white/40">Budget</p>
              <p className="num text-sm font-semibold text-white">{moneyWhole(stats.budget)}</p>
            </div>
          </div>
          <p className="text-center text-xs text-white/45">
            Projected month end:{' '}
            <span className={`num font-semibold ${stats.projected > stats.budget ? 'text-rose-300' : 'text-neon'}`}>
              {moneyWhole(stats.projected)}
            </span>
          </p>
        </div>
      ) : (
        <EmptyState
          icon={Target}
          title="No budget yet"
          message="Set a monthly limit and I'll tell you how much you can safely spend each day."
          action={
            <Link to="/budget" className="btn-primary">
              Set my budget
            </Link>
          }
        />
      )}
    </Card>
  );
}

function CategoryBreakdown({ data }) {
  const [active, setActive] = useState(null);
  const colors = usePalette().chart;
  if (!data.length) return <EmptyState title="No spending yet" message="Your expenses in this period will show up here." />;
  const focus = active != null ? data[active] : null;
  const total = data.reduce((s, c) => s + c.myShare, 0);

  return (
    <div className="grid items-center gap-6 md:grid-cols-[220px_1fr]">
      <div className="relative mx-auto h-[220px] w-[220px]">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="myShare"
              nameKey="category"
              innerRadius={72}
              outerRadius={100}
              paddingAngle={data.length > 1 ? 3 : 0}
              cornerRadius={6}
              stroke="none"
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {data.map((entry, i) => (
                <Cell
                  key={entry.category}
                  fill={colors[i % colors.length]}
                  opacity={active == null || active === i ? 1 : 0.25}
                  style={{ transition: 'opacity .2s', cursor: 'pointer' }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="eyebrow">{focus ? focus.category : 'Total'}</p>
          <p className="num mt-1 text-xl font-semibold text-white">{moneyWhole(focus ? focus.myShare : total)}</p>
          {focus && <p className="text-xs text-white/45">{Math.round(focus.percent)}%</p>}
        </div>
      </div>
      <ul className="space-y-1">
        {data.map((c, i) => (
          <li
            key={c.category}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            className={`cursor-default rounded-2xl px-3 py-2 transition ${active === i ? 'bg-white/[0.05]' : ''}`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium text-white/85">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                {c.category}
                <span className="text-xs font-normal text-white/35">×{c.count}</span>
              </span>
              <span className="num font-semibold text-white">{money(c.myShare)}</span>
            </div>
            <ProgressBar percent={c.percent} color={colors[i % colors.length]} className="h-1.5" />
            {c.spent !== c.myShare && (
              <p className="mt-1 text-[11px] text-white/35">Paid {money(c.spent)} in total, friends owe the rest</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendChart({ data }) {
  const p = usePalette();
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={p.neon} stopOpacity={0.35} />
              <stop offset="100%" stopColor={p.neon} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gSpent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={p.orchid} stopOpacity={0.35} />
              <stop offset="100%" stopColor={p.orchid} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 6" vertical={false} stroke={p.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke={p.axis} />
          <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={11} width={64} stroke={p.axis} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: p.cursor }} />
          <Area type="monotone" dataKey="income" name="Income" stroke={p.neon} strokeWidth={2.5} fill="url(#gIncome)" />
          <Area type="monotone" dataKey="myShare" name="My spending" stroke={p.orchid} strokeWidth={2.5} fill="url(#gSpent)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Dashboard() {
  const [periodId, setPeriodId] = useState('this-month');
  const range = useMemo(() => PERIODS.find((p) => p.id === periodId).range(), [periodId]);
  const { data, isLoading, error } = useSummary(range);
  const { data: insights } = useInsights();
  const { data: settings } = useSettings();
  const { data: people = [] } = usePeople();
  const { openTransaction } = useUI();
  const owing = people.filter((p) => p.pending > 0).slice(0, 5);
  const name = insights?.name ?? settings?.name ?? BRAND.owner;

  return (
    <div className="space-y-5">
      {error && <ErrorState error={error} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <AdvisorHero insights={insights} name={name} />
        {data ? <BalanceCard summary={data} /> : <Card className="p-6"><LoadingBlock /></Card>}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <InsightFeed insights={insights?.insights} />
        <BudgetPulse insights={insights} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <h2 className="font-display text-2xl font-semibold text-white">Money flow</h2>
        <div className="overflow-x-auto">
          <Segmented
            size="sm"
            value={periodId}
            onChange={setPeriodId}
            options={PERIODS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </div>
      </div>

      {isLoading && <LoadingBlock />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Income" value={data.period.income} icon={TrendingUp} hint="Excluding repayments" />
            <StatTile label="Total spent" value={data.period.spent} icon={TrendingDown} accent="text-rose-300" delay={0.05} hint={`${data.period.count} transactions`} />
            <StatTile label="My spending" value={data.period.myShare} icon={PiggyBank} accent="text-orchid" delay={0.1} hint="Your share after splits" />
            <StatTile label="Paid back" value={data.period.repayments} icon={HandCoins} accent="text-aqua" delay={0.15} hint={`${moneyWhole(data.pending.total)} still pending`} />
          </div>

          <div className="grid gap-5 xl:grid-cols-5">
            <Card className="p-5 xl:col-span-3">
              <h2 className="mb-4 font-display text-lg font-semibold text-white">Where it went</h2>
              <CategoryBreakdown data={data.byCategory} />
            </Card>
            <Card delay={0.05} className="p-5 xl:col-span-2">
              <h2 className="mb-4 font-display text-lg font-semibold text-white">6-month trend</h2>
              <TrendChart data={data.trend} />
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-5">
            <Card className="p-3 xl:col-span-3">
              <div className="flex items-center justify-between px-3 pt-2 pb-3">
                <h2 className="font-display text-lg font-semibold text-white">Recent activity</h2>
                <Link to="/transactions" className="text-xs font-medium text-white/45 hover:text-neon">
                  View all →
                </Link>
              </div>
              {data.recent.length ? (
                <TransactionList items={data.recent} compact />
              ) : (
                <EmptyState
                  title="Nothing here yet"
                  message="Add your salary and first expense to wake me up."
                  action={
                    <button className="btn-primary" onClick={() => openTransaction()}>
                      <Plus size={16} /> Add transaction
                    </button>
                  }
                />
              )}
            </Card>

            <Card delay={0.05} className="p-3 xl:col-span-2">
              <div className="flex items-center justify-between px-3 pt-2 pb-3">
                <h2 className="font-display text-lg font-semibold text-white">Who owes you</h2>
                <Link to="/splits" className="text-xs font-medium text-white/45 hover:text-neon">
                  Collect →
                </Link>
              </div>
              {owing.length ? (
                <ul className="space-y-0.5">
                  {owing.map((p) => (
                    <li key={p.name} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-white/[0.04]">
                      <Avatar name={p.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">{p.name}</p>
                        <p className="text-xs text-white/40">
                          {p.pendingCount} pending {p.pendingCount === 1 ? 'split' : 'splits'}
                        </p>
                      </div>
                      <p className="num font-semibold text-orchid">{money(p.pending)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={HandCoins} title="Nobody owes you" message="Split an expense and I'll track who needs to pay you back." />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
