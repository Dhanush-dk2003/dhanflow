import { Transaction } from '../models/Transaction.js';
import { dateRangeMatch, round2 } from '../utils/helpers.js';
import { isDebit, isIncome, myShareExpr, sumIf } from '../utils/expressions.js';
import { currentMonth } from '../utils/dates.js';
import { accountNames, listAccounts } from './account.service.js';
import { getBudgetStatus } from './budget.service.js';
import { listSplits } from './split.service.js';
import { buildFilter, sortSpec } from './transaction.service.js';

export const REPORTS = ['transactions', 'splits', 'people', 'accounts', 'budget', 'categories', 'monthly'];
export const REPORT_LABELS = {
  transactions: 'Entries',
  splits: 'Split shares',
  people: 'Friends & splits',
  accounts: 'Accounts',
  budget: 'Budget',
  categories: 'Spending by category',
  monthly: 'Month by month',
};

const TYPE_LABELS = { credit: 'Money in', debit: 'Money out', transfer: 'Transfer' };
const METHOD_LABELS = { upi: 'UPI', cash: 'Cash', card: 'Card', bank: 'Bank', other: 'Other' };
const DAY_MS = 864e5;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const daysBetween = (from, to) => Math.max(0, Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS));
const startOfDay = (d) => Date.parse(`${iso(d)}T00:00:00Z`);
const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);
const inRange = (date, from, to) => (!from || iso(date) >= from) && (!to || iso(date) <= to);

/**
 * Every split share with how long it took to be paid back (or how long it has been waiting).
 * `range` filters on the bill date.
 */
export async function splitShares({ person, status = 'all', from, to } = {}) {
  const { items } = await listSplits({ status, person });
  const today = new Date();
  return items
    .filter((s) => inRange(s.date, from, to))
    .map((s) => ({
      person: s.name,
      for: s.description || s.category,
      category: s.category,
      billDate: iso(s.date),
      amount: s.amount,
      status: s.isPaid ? 'Paid' : 'Pending',
      paidOn: s.isPaid ? iso(s.paidAt) : null,
      daysToPay: s.isPaid && s.paidAt ? daysBetween(s.date, s.paidAt) : null,
      daysWaiting: s.isPaid ? null : daysBetween(s.date, today),
      transactionId: String(s.transactionId),
    }));
}

/** Per person: what they owed in total, paid back, still owe, and how fast they pay. */
export function peopleSummary(shares) {
  const byPerson = new Map();
  for (const s of shares) {
    const key = s.person.toLowerCase();
    if (!byPerson.has(key)) byPerson.set(key, { person: s.person, shares: [], });
    byPerson.get(key).shares.push(s);
  }
  return [...byPerson.values()]
    .map(({ person, shares: list }) => {
      const paid = list.filter((s) => s.status === 'Paid');
      const pending = list.filter((s) => s.status === 'Pending');
      return {
        person,
        shares: list.length,
        total: round2(list.reduce((n, s) => n + s.amount, 0)),
        paid: round2(paid.reduce((n, s) => n + s.amount, 0)),
        pending: round2(pending.reduce((n, s) => n + s.amount, 0)),
        avgDaysToPay: avg(paid.map((s) => s.daysToPay).filter((d) => d != null)),
        slowestPayDays: paid.length ? Math.max(...paid.map((s) => s.daysToPay ?? 0)) : null,
        oldestPendingDays: pending.length ? Math.max(...pending.map((s) => s.daysWaiting)) : null,
        lastPaidOn: paid.map((s) => s.paidOn).sort().at(-1) ?? null,
      };
    })
    .sort((a, b) => b.pending - a.pending || b.total - a.total);
}

const col = (key, label, type = 'text') => ({ key, label, type });

const builders = {
  async transactions(f, limit) {
    const filter = buildFilter(f);
    const [items, count, names] = await Promise.all([
      Transaction.find(filter).sort(sortSpec(f.sort ?? '-date')).limit(limit).lean(),
      Transaction.countDocuments(filter),
      accountNames(),
    ]);
    const nameOf = (id) => (id ? (names.get(String(id)) ?? '') : '');
    return {
      count,
      columns: [
        col('date', 'Date', 'date'),
        col('type', 'Type'),
        col('category', 'Category'),
        col('description', 'Description'),
        col('account', 'Account'),
        col('method', 'Paid via'),
        col('amount', 'Amount', 'money'),
        col('splitWith', 'Split with'),
      ],
      rows: items.map((t) => ({
        date: iso(t.date),
        type: TYPE_LABELS[t.type],
        category: t.category,
        description: t.description || '',
        account: t.type === 'transfer' ? `${nameOf(t.account)} → ${nameOf(t.toAccount)}` : nameOf(t.account),
        method: t.type === 'transfer' ? '' : (METHOD_LABELS[t.paymentMethod] ?? ''),
        amount: t.type === 'debit' ? -t.amount : t.amount,
        splitWith: t.owedTo
          ? `Paid by ${t.owedTo.name} (${t.owedTo.isPaid ? 'paid back' : 'I owe'})`
          : (t.participants ?? []).map((p) => `${p.name} ₹${p.amount} (${p.isPaid ? 'paid' : 'pending'})`).join('; '),
      })),
    };
  },

  async splits(f, limit) {
    const shares = await splitShares(f);
    return {
      count: shares.length,
      columns: [
        col('person', 'Person'),
        col('for', 'For'),
        col('billDate', 'Bill date', 'date'),
        col('amount', 'Share', 'money'),
        col('status', 'Status'),
        col('paidOn', 'Paid on', 'date'),
        col('daysToPay', 'Days to pay', 'days'),
        col('daysWaiting', 'Waiting', 'days'),
      ],
      rows: shares.slice(0, limit),
    };
  },

  async people(f, limit) {
    const rows = peopleSummary(await splitShares({ ...f, status: 'all' }));
    return {
      count: rows.length,
      columns: [
        col('person', 'Person'),
        col('shares', 'Splits', 'number'),
        col('total', 'Total share', 'money'),
        col('paid', 'Paid back', 'money'),
        col('pending', 'Still owes', 'money'),
        col('avgDaysToPay', 'Avg days to pay', 'days'),
        col('slowestPayDays', 'Slowest', 'days'),
        col('oldestPendingDays', 'Oldest unpaid', 'days'),
        col('lastPaidOn', 'Last paid', 'date'),
      ],
      rows: rows.slice(0, limit),
    };
  },

  async accounts() {
    const { accounts, unassigned, total } = await listAccounts();
    const rows = accounts.map((a) => ({
      name: a.name,
      type: a.type,
      balance: a.balance,
      monthIn: a.monthIn,
      monthOut: a.monthOut,
      status: a.archived ? 'Archived' : a.isDefault ? 'Default' : 'Active',
    }));
    if (unassigned) rows.push({ name: 'Not linked to an account', type: '', balance: unassigned.balance, monthIn: null, monthOut: null, status: '' });
    rows.push({ name: 'Total', type: '', balance: total, monthIn: null, monthOut: null, status: '' });
    return {
      count: rows.length,
      columns: [
        col('name', 'Account'),
        col('type', 'Type'),
        col('balance', 'Balance', 'money'),
        col('monthIn', 'In this month', 'money'),
        col('monthOut', 'Out this month', 'money'),
        col('status', 'Status'),
      ],
      rows,
    };
  },

  async budget(f) {
    const month = f.month ?? currentMonth();
    const b = await getBudgetStatus(month, { withSuggestion: false });
    const rows = b.categories.map((c) => ({ category: c.category, limit: c.limit, spent: c.spent, remaining: c.remaining, percent: c.percent }));
    rows.push({ category: 'Total', limit: b.budget?.total ?? null, spent: b.spent, remaining: b.remaining, percent: b.percent });
    return {
      count: rows.length,
      subtitle: month,
      columns: [
        col('category', 'Category'),
        col('limit', 'Limit', 'money'),
        col('spent', 'Spent', 'money'),
        col('remaining', 'Left', 'money'),
        col('percent', 'Used', 'percent'),
      ],
      rows,
    };
  },

  async categories(f, limit) {
    const rows = await Transaction.aggregate([
      { $match: { ...buildFilter({ ...f, type: 'debit' }) } },
      { $group: { _id: '$category', entries: { $sum: 1 }, spent: { $sum: '$amount' }, myShare: { $sum: myShareExpr } } },
      { $sort: { spent: -1 } },
    ]);
    const total = rows.reduce((n, r) => n + r.spent, 0);
    return {
      count: rows.length,
      columns: [
        col('category', 'Category'),
        col('entries', 'Entries', 'number'),
        col('spent', 'Spent', 'money'),
        col('myShare', 'My share', 'money'),
        col('percent', 'Share of spending', 'percent'),
      ],
      rows: rows.slice(0, limit).map((r) => ({
        category: r._id,
        entries: r.entries,
        spent: round2(r.spent),
        myShare: round2(r.myShare),
        percent: total ? round2((r.spent / total) * 100) : 0,
      })),
    };
  },

  async monthly(f, limit) {
    const rows = await Transaction.aggregate([
      { $match: { ...dateRangeMatch(f.from, f.to), type: { $in: ['credit', 'debit'] }, ...(f.account ? buildFilter({ account: f.account }) : {}) } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          income: sumIf(isIncome),
          spent: sumIf(isDebit),
          myShare: sumIf(isDebit, myShareExpr),
          entries: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: limit },
    ]);
    return {
      count: rows.length,
      columns: [
        col('month', 'Month'),
        col('income', 'Income', 'money'),
        col('spent', 'Spent', 'money'),
        col('myShare', 'My share', 'money'),
        col('net', 'Saved', 'money'),
        col('entries', 'Entries', 'number'),
      ],
      rows: rows.map((r) => ({
        month: new Date(`${r._id}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        income: round2(r.income),
        spent: round2(r.spent),
        myShare: round2(r.myShare),
        net: round2(r.income - r.spent),
        entries: r.entries,
      })),
    };
  },
};

/** Describes the filters in words, for file headers and cards. */
export function describeReportFilters(report, f, names) {
  const day = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const parts = [];
  if (report === 'budget') parts.push(f.month ?? currentMonth());
  else if (!['accounts'].includes(report)) parts.push(f.from || f.to ? `${f.from ? day(f.from) : 'Start'} – ${f.to ? day(f.to) : 'Today'}` : 'All time');
  if (f.type) parts.push(TYPE_LABELS[f.type]);
  if (f.category) parts.push(f.category);
  if (f.account) parts.push(f.account === 'none' ? 'No account' : (names?.get(String(f.account)) ?? 'One account'));
  if (f.split) parts.push(f.split === 'true' ? 'Split only' : 'Not split');
  if (f.person) parts.push(f.person);
  if (f.status && f.status !== 'all') parts.push(f.status === 'paid' ? 'Paid back' : 'Pending');
  if (f.search) parts.push(`“${f.search}”`);
  return parts.join(' · ');
}

/**
 * One table of app data, used for chat tables and every download format.
 * Returns `{ report, title, subtitle, columns: [{ key, label, type }], rows, count, truncated }`.
 */
export async function buildReport(report, filters = {}, { limit = 500 } = {}) {
  const build = builders[report];
  if (!build) throw new Error(`Unknown report ${report}`);
  const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const result = await build(f, limit);
  const names = f.account ? await accountNames() : null;
  return {
    report,
    title: REPORT_LABELS[report],
    subtitle: result.subtitle ?? describeReportFilters(report, f, names),
    columns: result.columns,
    rows: result.rows,
    count: result.count,
    truncated: result.count > result.rows.length,
  };
}
