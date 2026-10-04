import { Transaction } from '../models/Transaction.js';
import { isDebit, isIncome, myShareExpr, sumIf } from '../utils/expressions.js';
import { currentMonth, daysInMonth, monthBounds, shiftMonth, todayISO } from '../utils/dates.js';
import { clamp, inr, round2 } from '../utils/helpers.js';
import { getBudgetStatus } from './budget.service.js';
import { pendingByPerson } from './notification.service.js';
import { getSettings } from './settings.service.js';

const DAY_MS = 86_400_000;
const TONE_ORDER = { alert: 0, warn: 1, good: 2, info: 3 };

function scoreLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs attention';
}

/** Rule-based "advisor" that turns this month's numbers into plain-language guidance. */
export async function getInsights() {
  const month = currentMonth();
  const day = Number(todayISO().slice(8, 10));
  const prev = shiftMonth(month, -1);
  const [py, pm] = prev.split('-').map(Number);
  const { start, end } = monthBounds(month);
  const prevStart = monthBounds(prev).start;
  const prevSameDayEnd = new Date(Date.UTC(py, pm - 1, Math.min(day, daysInMonth(prev)) + 1));

  const [settings, status, [cur], [last], people] = await Promise.all([
    getSettings(),
    getBudgetStatus(month),
    Transaction.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      { $group: { _id: null, income: sumIf(isIncome), spent: sumIf(isDebit, myShareExpr) } },
    ]),
    Transaction.aggregate([
      { $match: { type: 'debit', date: { $gte: prevStart, $lt: prevSameDayEnd } } },
      { $group: { _id: null, spent: { $sum: myShareExpr } } },
    ]),
    pendingByPerson(),
  ]);

  const income = round2(cur?.income);
  const spent = round2(cur?.spent);
  const lastSpent = round2(last?.spent);
  const budgetTotal = status.budget?.total ?? 0;
  const now = Date.now();
  const overdue = people.filter((p) => now - new Date(p.oldest).getTime() >= settings.reminderAfterDays * DAY_MS);
  const toCollect = round2(people.reduce((s, p) => s + p.amount, 0));
  const insights = [];

  // Budget pace
  if (!budgetTotal) {
    const avg = status.suggestion ? status.suggestion.total : 0;
    insights.push({
      id: 'no-budget',
      tone: 'info',
      icon: 'target',
      title: 'Set a monthly budget',
      message: avg
        ? `Your spending averaged about ${inr(avg)} a month recently. Set a budget and I'll warn you before you overspend.`
        : "Set a budget and I'll track your pace every day.",
      action: { label: 'Set budget', to: '/budget' },
    });
  } else if (status.spent > budgetTotal) {
    insights.push({
      id: 'over-budget',
      tone: 'alert',
      icon: 'flame',
      title: `Over budget by ${inr(status.spent - budgetTotal)}`,
      message: `You've spent ${inr(status.spent)} against your ${inr(budgetTotal)} budget. Hold off on non-essentials for the rest of the month.`,
      action: { label: 'Review budget', to: '/budget' },
    });
  } else if (status.projected > budgetTotal) {
    insights.push({
      id: 'pace',
      tone: 'warn',
      icon: 'gauge',
      title: "You're spending faster than planned",
      message: `At this pace you'll reach ${inr(status.projected)} by month end, ${inr(status.projected - budgetTotal)} over. Keep daily spending under ${inr(status.safeDaily)} to stay on track.`,
      action: { label: 'See budget', to: '/budget' },
    });
  } else {
    insights.push({
      id: 'on-track',
      tone: 'good',
      icon: 'target',
      title: "You're on track this month",
      message: `You can spend up to ${inr(status.safeDaily)} a day for the next ${status.daysLeft} days and still stay within budget.`,
    });
  }

  // Category limits
  const watched = status.categories.filter((c) => c.limit && (c.percent > 100 || (c.percent >= 80 && !c.fixed)));
  for (const c of watched.slice(0, 3)) {
    const over = c.percent > 100;
    insights.push({
      id: `cat-${c.category}`,
      tone: over ? 'alert' : 'warn',
      icon: 'flame',
      title: over ? `${c.category} budget exceeded` : `${c.category} is at ${Math.round(c.percent)}%`,
      message: over
        ? `${inr(c.spent)} spent against ${inr(c.limit)}, ${inr(c.spent - c.limit)} over.`
        : c.remaining > 0
          ? `Only ${inr(c.remaining)} left in ${c.category} for this month.`
          : `Your ${c.category} budget is fully used for this month.`,
    });
  }

  // Month over month
  if (lastSpent > 0 && spent > 0) {
    const change = ((spent - lastSpent) / lastSpent) * 100;
    if (change >= 15) {
      insights.push({
        id: 'mom-up',
        tone: 'warn',
        icon: 'trending-up',
        title: `Spending up ${Math.round(change)}% vs last month`,
        message: `By this date last month you had spent ${inr(lastSpent)}; this month it's ${inr(spent)}.`,
      });
    } else if (change <= -10) {
      insights.push({
        id: 'mom-down',
        tone: 'good',
        icon: 'trending-down',
        title: `Spending down ${Math.round(-change)}% vs last month`,
        message: `${inr(lastSpent - spent)} less than at this point last month. Nice discipline.`,
      });
    }
  }

  // Top category
  const top = [...status.categories].sort((a, b) => b.spent - a.spent)[0];
  if (top && spent > 0) {
    insights.push({
      id: 'top-category',
      tone: 'info',
      icon: 'sparkles',
      title: `Most money went to ${top.category}`,
      message: `${inr(top.spent)}, which is ${Math.round((top.spent / spent) * 100)}% of your spending this month.`,
    });
  }

  // Savings rate
  if (income > 0) {
    const rate = ((income - spent) / income) * 100;
    if (rate < 0) {
      insights.push({
        id: 'negative-savings',
        tone: 'alert',
        icon: 'piggy-bank',
        title: 'Spending more than you earned',
        message: `You've earned ${inr(income)} but spent ${inr(spent)} this month.`,
      });
    } else if (rate >= 30) {
      insights.push({
        id: 'savings-great',
        tone: 'good',
        icon: 'piggy-bank',
        title: `You're saving ${Math.round(rate)}% of your income`,
        message: `${inr(income - spent)} kept aside so far this month. Consider moving some into savings or investments.`,
      });
    } else if (rate < 10) {
      insights.push({
        id: 'savings-low',
        tone: 'warn',
        icon: 'piggy-bank',
        title: `Only ${Math.round(rate)}% of income saved`,
        message: 'Aim for at least 20%. Trimming your top category is the quickest win.',
      });
    }
  }

  // Collections
  if (overdue.length) {
    const amount = round2(overdue.reduce((s, p) => s + p.amount, 0));
    insights.push({
      id: 'overdue',
      tone: 'warn',
      icon: 'hand-coins',
      title: `Collect ${inr(amount)} from ${overdue.length} ${overdue.length === 1 ? 'person' : 'people'}`,
      message: overdue
        .slice(0, 4)
        .map((p) => `${p.name} ${inr(p.amount)} (${Math.floor((now - new Date(p.oldest).getTime()) / DAY_MS)} days)`)
        .join(', '),
      action: { label: 'Collect now', to: '/splits' },
    });
  } else if (toCollect > 0) {
    insights.push({
      id: 'pending',
      tone: 'info',
      icon: 'hand-coins',
      title: `${inr(toCollect)} is with friends`,
      message: `${people.map((p) => p.name).join(', ')} still ${people.length === 1 ? 'owes' : 'owe'} you. I'll remind you if it goes past ${settings.reminderAfterDays} days.`,
      action: { label: 'View', to: '/splits' },
    });
  }

  if (!income && !spent && !toCollect) {
    insights.push({
      id: 'start',
      tone: 'info',
      icon: 'sparkles',
      title: "Let's get started",
      message: 'Add your salary and a few expenses. I will start spotting patterns right away.',
    });
  }

  insights.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);

  // Money score: savings (40) + budget discipline (40) + collections (20)
  let score = income > 0 ? clamp((income - spent) / income / 0.3, 0, 1) * 40 : spent > 0 ? 10 : 20;
  score += budgetTotal
    ? status.projected <= budgetTotal
      ? 40
      : clamp(1 - (status.projected / budgetTotal - 1) * 2, 0, 1) * 40
    : 20;
  score += Math.max(0, 20 - overdue.length * 5);
  score = Math.round(score);

  let headline;
  if (!budgetTotal) headline = 'Set a budget and I will keep an eye on your spending.';
  else if (status.spent > budgetTotal) headline = 'You are over budget. Time to slow down.';
  else if (status.projected > budgetTotal) headline = 'Careful, you are spending faster than planned.';
  else headline = 'You are on track this month. Keep it going.';

  return {
    name: settings.name,
    month,
    headline,
    score: { value: score, label: scoreLabel(score) },
    stats: {
      income,
      spent,
      savingsRate: income > 0 ? round2(((income - spent) / income) * 100) : null,
      budget: budgetTotal || null,
      projected: status.projected,
      safeDaily: status.safeDaily,
      daysLeft: status.daysLeft,
      toCollect,
      overdueCount: overdue.length,
    },
    insights,
  };
}
