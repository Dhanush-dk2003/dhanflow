import { Transaction } from '../models/Transaction.js';
import { round2 } from '../utils/helpers.js';
import { isDebit, isIncome, sumIf } from '../utils/expressions.js';
import { accountNames } from './account.service.js';
import { splitShares } from './report.service.js';
import { buildFilter } from './transaction.service.js';

export const SPLIT_METRICS = ['owed', 'repaid', 'owed_vs_repaid', 'days_to_pay', 'days_waiting'];
export const CHART_METRICS = ['spending', 'income', 'income_vs_spending', 'count', ...SPLIT_METRICS];
export const CHART_GROUPS = ['category', 'day', 'week', 'month', 'payee', 'account', 'payment_method', 'person'];
export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'donut'];

const TIME_GROUPS = new Set(['day', 'week', 'month']);
const METHOD_LABELS = { upi: 'UPI', cash: 'Cash', card: 'Card', bank: 'Bank', other: 'Other' };
const SERIES = {
  spending: [{ key: 'spent', label: 'Spent' }],
  income: [{ key: 'income', label: 'Income' }],
  income_vs_spending: [
    { key: 'income', label: 'Income' },
    { key: 'spent', label: 'Spent' },
  ],
  count: [{ key: 'count', label: 'Entries', format: 'count' }],
  owed: [{ key: 'pending', label: 'Still owes' }],
  repaid: [{ key: 'paid', label: 'Paid back' }],
  owed_vs_repaid: [
    { key: 'paid', label: 'Paid back' },
    { key: 'pending', label: 'Still owes' },
  ],
  days_to_pay: [{ key: 'days', label: 'Avg days to pay', format: 'days', aggregate: 'avg' }],
  days_waiting: [{ key: 'days', label: 'Longest wait', format: 'days', aggregate: 'max' }],
};
const MAX_POINTS = { day: 120, week: 60, month: 36 };

const payeeLabel = { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$description', ''] } }, 0] }, '$description', '$category'] };

function groupKey(groupBy) {
  switch (groupBy) {
    case 'category':
      return '$category';
    case 'payee':
      return { $toLower: payeeLabel };
    case 'account':
      return '$account';
    case 'payment_method':
      return '$paymentMethod';
    default:
      return { $dateTrunc: { date: '$date', unit: groupBy, ...(groupBy === 'week' ? { startOfWeek: 'monday' } : {}) } };
  }
}

const iso = (d) => d.toISOString().slice(0, 10);
const timeLabel = (date, unit) => {
  const opts = unit === 'month' ? { month: 'short', year: 'numeric' } : { day: '2-digit', month: 'short' };
  return date.toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
};

/** Every period between from and to, so quiet days/weeks/months show as zero instead of vanishing. */
function periodsBetween(from, to, unit) {
  const start = new Date(`${from}T00:00:00Z`);
  if (unit === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (unit === 'month') start.setUTCDate(1);
  const end = new Date(`${to}T00:00:00Z`);
  const out = [];
  for (const d = start; d <= end && out.length <= MAX_POINTS[unit]; ) {
    out.push(new Date(d));
    if (unit === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (unit === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out.length <= MAX_POINTS[unit] ? out : null;
}

function defaultChart(groupBy, metric, points) {
  if (TIME_GROUPS.has(groupBy)) return metric === 'income_vs_spending' ? 'bar' : 'area';
  if (metric !== 'income_vs_spending' && ['category', 'payment_method', 'account'].includes(groupBy) && points <= 8) return 'donut';
  return 'bar';
}

const truncDay = (day, unit) => {
  if (unit === 'month') return `${day.slice(0, 7)}-01`;
  if (unit === 'week') {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return iso(d);
  }
  return day;
};
const average = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : 0);

/**
 * Split charts: who owes what, what's been paid back, and how quickly people pay.
 * Repayment metrics use the day it was paid back; the rest use the bill date.
 */
async function buildSplitChart({ metric, groupBy, from, to, category, search, person, chart, title, limit }) {
  const status = { owed: 'pending', days_waiting: 'pending', repaid: 'paid', days_to_pay: 'paid' }[metric] ?? 'all';
  const byPaidDay = metric === 'repaid' || metric === 'days_to_pay';
  const when = (s) => (byPaidDay ? s.paidOn : s.billDate);
  const group = TIME_GROUPS.has(groupBy) || ['category', 'payee'].includes(groupBy) ? groupBy : 'person';
  const wanted = search?.toLowerCase();

  const shares = (await splitShares({ person, status })).filter(
    (s) =>
      when(s) &&
      (!from || when(s) >= from) &&
      (!to || when(s) <= to) &&
      (!category || s.category.toLowerCase() === category.toLowerCase()) &&
      (!wanted || s.for.toLowerCase().includes(wanted)),
  );

  const keyOf = (s) => {
    if (TIME_GROUPS.has(group)) return truncDay(when(s), group);
    if (group === 'category') return s.category;
    if (group === 'payee') return s.for;
    return s.person;
  };
  const groups = new Map();
  for (const s of shares) {
    const key = TIME_GROUPS.has(group) ? keyOf(s) : keyOf(s).toLowerCase();
    if (!groups.has(key)) groups.set(key, { label: keyOf(s), paid: 0, pending: 0, days: [], count: 0 });
    const g = groups.get(key);
    g[s.status === 'Paid' ? 'paid' : 'pending'] += s.amount;
    g.count += 1;
    const days = metric === 'days_to_pay' ? s.daysToPay : s.daysWaiting;
    if (days != null) g.days.push(days);
  }
  const point = (g) => ({
    label: g.label,
    paid: round2(g.paid),
    pending: round2(g.pending),
    days: metric === 'days_waiting' ? Math.max(0, ...g.days) : average(g.days),
    count: g.count,
  });

  const series = SERIES[metric];
  const primary = series[series.length - 1].key;
  let data;
  if (TIME_GROUPS.has(group)) {
    const periods = from && to ? periodsBetween(from, to, group) : null;
    const keys = periods ? periods.map(iso) : [...groups.keys()].sort();
    data = keys.map((k) => ({ ...point(groups.get(k) ?? { paid: 0, pending: 0, days: [], count: 0 }), label: timeLabel(new Date(`${k}T00:00:00Z`), group) }));
  } else {
    const sorted = [...groups.values()].map(point).sort((a, b) => b[primary] - a[primary] || b.paid + b.pending - (a.paid + a.pending));
    data = sorted.slice(0, limit);
    const rest = sorted.slice(limit);
    if (rest.length && !series[0].aggregate) {
      data.push({
        label: `Others (${rest.length})`,
        paid: round2(rest.reduce((n, r) => n + r.paid, 0)),
        pending: round2(rest.reduce((n, r) => n + r.pending, 0)),
        count: rest.reduce((n, r) => n + r.count, 0),
      });
    }
  }

  const allDays = shares.map((s) => (metric === 'days_to_pay' ? s.daysToPay : s.daysWaiting)).filter((d) => d != null);
  const total = Object.fromEntries(
    series.map((s) => [
      s.key,
      s.aggregate === 'avg' ? average(allDays) : s.aggregate === 'max' ? Math.max(0, ...allDays) : round2(data.reduce((n, r) => n + (r[s.key] ?? 0), 0)),
    ]),
  );
  const isDays = Boolean(series[0].aggregate);
  return {
    chart: chart ?? (isDays || metric === 'owed_vs_repaid' ? 'bar' : TIME_GROUPS.has(group) ? 'bar' : data.length <= 8 ? 'donut' : 'bar'),
    title,
    series,
    data,
    total,
    period: { from: from ?? null, to: to ?? null },
    groupBy: group,
  };
}

/**
 * Builds chart data straight from the database, so every number on screen is real.
 * Returns `{ chart, title, series, data: [{ label, spent?, income?, count? }], total }`.
 */
export async function buildChart({ metric, groupBy, from, to, category, search, account, person, chart, title, limit = 10 }) {
  if (SPLIT_METRICS.includes(metric)) return buildSplitChart({ metric, groupBy, from, to, category, search, person, chart, title, limit });
  if (groupBy === 'person') groupBy = 'payee';
  const match = { ...buildFilter({ from, to, category, search, account }) };
  match.type = metric === 'spending' ? 'debit' : metric === 'income' ? 'credit' : { $in: ['credit', 'debit'] };

  const rows = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: groupKey(groupBy),
        name: { $first: groupBy === 'payee' ? payeeLabel : '$category' },
        spent: sumIf(isDebit),
        income: sumIf(isIncome),
        count: { $sum: metric === 'income' ? { $cond: [isIncome, 1, 0] } : 1 },
      },
    },
    { $limit: 2000 },
  ]);

  const series = SERIES[metric];
  const pick = (r) => Object.fromEntries(series.map((s) => [s.key, s.key === 'count' ? r.count : round2(r[s.key])]));
  const primary = series[series.length - 1].key;
  let data;

  if (TIME_GROUPS.has(groupBy)) {
    const byPeriod = new Map(rows.map((r) => [iso(r._id), r]));
    const periods = from && to ? periodsBetween(from, to, groupBy) : null;
    const keys = periods ? periods.map(iso) : [...byPeriod.keys()].sort();
    data = keys.map((k) => {
      const r = byPeriod.get(k) ?? { spent: 0, income: 0, count: 0 };
      return { label: timeLabel(new Date(`${k}T00:00:00Z`), groupBy), ...pick(r) };
    });
  } else {
    const names = groupBy === 'account' ? await accountNames() : null;
    const label = (r) => {
      if (groupBy === 'account') return names.get(String(r._id)) ?? 'No account';
      if (groupBy === 'payment_method') return METHOD_LABELS[r._id] ?? 'Other';
      if (groupBy === 'payee') return r.name || 'Unnamed';
      return r._id || 'Other';
    };
    const sorted = rows
      .map((r) => ({ label: label(r), ...pick(r) }))
      .filter((r) => series.some((s) => r[s.key] > 0))
      .sort((a, b) => b[primary] - a[primary]);
    data = sorted.slice(0, limit);
    const rest = sorted.slice(limit);
    if (rest.length) {
      const others = { label: `Others (${rest.length})` };
      for (const s of series) others[s.key] = round2(rest.reduce((n, r) => n + r[s.key], 0));
      data.push(others);
    }
  }

  const total = Object.fromEntries(series.map((s) => [s.key, round2(data.reduce((n, r) => n + (r[s.key] ?? 0), 0))]));
  return {
    chart: chart ?? defaultChart(groupBy, metric, data.length),
    title,
    series,
    data,
    total,
    period: { from: from ?? null, to: to ?? null },
    groupBy,
  };
}
