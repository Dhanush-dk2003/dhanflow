import { Budget } from '../models/Budget.js';
import { Transaction } from '../models/Transaction.js';
import { myShareExpr } from '../utils/expressions.js';
import { currentMonth, daysInMonth, monthBounds, shiftMonth, todayISO } from '../utils/dates.js';
import { round2 } from '../utils/helpers.js';

const roundUpTo100 = (n) => Math.ceil(n / 100) * 100;

// Paid once a month, so they are not extrapolated as a daily spending rate.
export const FIXED_CATEGORIES = new Set(['rent', 'bills', 'emi', 'insurance', 'education', 'investment', 'subscriptions']);
export const isFixedCategory = (category) => FIXED_CATEGORIES.has(category.toLowerCase());

/** The budget saved for this month, or else the latest one saved before it. */
export const findEffectiveBudget = (month) => Budget.findOne({ month: { $lte: month } }).sort({ month: -1 }).lean();

const spendingByCategory = (start, end) =>
  Transaction.aggregate([
    { $match: { type: 'debit', date: { $gte: start, $lt: end } } },
    { $group: { _id: '$category', spent: { $sum: myShareExpr } } },
  ]);

/** Suggests limits from the average of my own spending over the previous three months. */
async function suggestBudget(month) {
  const { start } = monthBounds(shiftMonth(month, -3));
  const { start: end } = monthBounds(month);

  const rows = await Transaction.aggregate([
    { $match: { type: 'debit', date: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: { category: '$category', month: { $dateToString: { format: '%Y-%m', date: '$date' } } },
        spent: { $sum: myShareExpr },
      },
    },
    { $group: { _id: '$_id.category', total: { $sum: '$spent' }, months: { $addToSet: '$_id.month' } } },
  ]);

  const activeMonths = new Set(rows.flatMap((r) => r.months)).size;
  if (!activeMonths) return null;

  const categories = rows
    .map((r) => ({ category: r._id, limit: roundUpTo100(r.total / activeMonths) }))
    .filter((c) => c.limit > 0)
    .sort((a, b) => b.limit - a.limit);

  return {
    basedOnMonths: activeMonths,
    total: categories.reduce((s, c) => s + c.limit, 0),
    categories,
  };
}

function dayStats(month) {
  const now = currentMonth();
  const dim = daysInMonth(month);
  if (month < now) return { daysInMonth: dim, daysElapsed: dim, daysLeft: 0 };
  if (month > now) return { daysInMonth: dim, daysElapsed: 0, daysLeft: dim };
  const today = Number(todayISO().slice(8, 10));
  return { daysInMonth: dim, daysElapsed: today, daysLeft: dim - today + 1 };
}

export async function getBudgetStatus(month, { withSuggestion = true } = {}) {
  const { start, end } = monthBounds(month);
  const [budget, rows, suggestion] = await Promise.all([
    findEffectiveBudget(month),
    spendingByCategory(start, end),
    withSuggestion ? suggestBudget(month) : null,
  ]);

  const days = dayStats(month);
  const spentByCategory = new Map(rows.map((r) => [r._id, round2(r.spent)]));
  const spent = round2(rows.reduce((s, r) => s + r.spent, 0));
  const total = budget?.total ?? 0;
  const limits = new Map((budget?.categories ?? []).map((c) => [c.category, c.limit]));

  const categories = [...new Set([...limits.keys(), ...spentByCategory.keys()])]
    .map((category) => {
      const limit = limits.get(category) ?? null;
      const catSpent = spentByCategory.get(category) ?? 0;
      return {
        category,
        limit,
        spent: catSpent,
        remaining: limit != null ? round2(limit - catSpent) : null,
        percent: limit ? round2((catSpent / limit) * 100) : null,
        fixed: isFixedCategory(category),
      };
    })
    .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || b.spent - a.spent);

  const fixedSpent = categories.filter((c) => c.fixed).reduce((s, c) => s + c.spent, 0);
  const isCurrent = month === currentMonth();
  const projected =
    isCurrent && days.daysElapsed
      ? round2(fixedSpent + ((spent - fixedSpent) / days.daysElapsed) * days.daysInMonth)
      : spent;

  return {
    month,
    budget: budget
      ? { total, categories: budget.categories, sourceMonth: budget.month, inherited: budget.month !== month }
      : null,
    spent,
    remaining: total ? round2(total - spent) : null,
    percent: total ? round2((spent / total) * 100) : null,
    projected,
    safeDaily: total && days.daysLeft ? round2(Math.max(0, total - spent) / days.daysLeft) : null,
    ...days,
    categories,
    suggestion,
  };
}

export const saveBudget = (month, { total, categories }) =>
  Budget.findOneAndUpdate(
    { month },
    { $set: { total, categories } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();

export const deleteBudget = (month) => Budget.deleteOne({ month });
