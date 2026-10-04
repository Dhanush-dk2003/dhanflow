import { Notification } from '../models/Notification.js';
import { Transaction } from '../models/Transaction.js';
import { ApiError } from '../utils/ApiError.js';
import { currentMonth, daysInMonth, monthLabel, shiftMonth, todayISO } from '../utils/dates.js';
import { inr, round2 } from '../utils/helpers.js';
import { getBudgetStatus } from './budget.service.js';
import { getSettings } from './settings.service.js';

const DAY_MS = 86_400_000;

/** Inserts a notification once per key. Returns true when it was newly created. */
async function notify({ key, ...doc }) {
  const res = await Notification.updateOne({ key }, { $setOnInsert: { key, ...doc } }, { upsert: true });
  return res.upsertedCount > 0;
}

export async function listNotifications({ limit, unread }) {
  const [items, unreadCount] = await Promise.all([
    Notification.find(unread ? { read: false } : {})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Notification.countDocuments({ read: false }),
  ]);
  return { items, unreadCount };
}

export async function markRead(id) {
  const n = await Notification.findByIdAndUpdate(id, { $set: { read: true } }, { returnDocument: 'after' }).lean();
  if (!n) throw ApiError.notFound('Notification not found');
  return n;
}

export const markAllRead = () => Notification.updateMany({ read: false }, { $set: { read: true } });

export async function deleteNotification(id) {
  const n = await Notification.findByIdAndDelete(id).lean();
  if (!n) throw ApiError.notFound('Notification not found');
}

export const clearRead = () => Notification.deleteMany({ read: true });

/** Removes pending "X still owes you" reminders once that share is paid. */
export const resolveOverdue = (participantId) =>
  Notification.deleteMany({ type: 'overdue', 'data.participantId': String(participantId) });

export async function pendingByPerson() {
  const rows = await Transaction.aggregate([
    { $match: { participants: { $elemMatch: { isPaid: false } } } },
    { $unwind: '$participants' },
    { $match: { 'participants.isPaid': false } },
    {
      $group: {
        _id: { $toLower: '$participants.name' },
        name: { $first: '$participants.name' },
        amount: { $sum: '$participants.amount' },
        count: { $sum: 1 },
        oldest: { $min: '$date' },
      },
    },
    { $sort: { amount: -1 } },
  ]);
  return rows.map(({ _id, amount, ...rest }) => ({ ...rest, amount: round2(amount) }));
}

export async function checkOverdueSplits() {
  const { reminderAfterDays } = await getSettings();
  const now = Date.now();
  const rows = await Transaction.aggregate([
    {
      $match: {
        date: { $lte: new Date(now - reminderAfterDays * DAY_MS) },
        participants: { $elemMatch: { isPaid: false } },
      },
    },
    { $unwind: '$participants' },
    { $match: { 'participants.isPaid': false } },
    {
      $project: {
        participantId: '$participants._id',
        name: '$participants.name',
        amount: '$participants.amount',
        date: 1,
        description: 1,
        category: 1,
      },
    },
  ]);

  for (const row of rows) {
    const days = Math.floor((now - row.date.getTime()) / DAY_MS);
    // Re-remind every `reminderAfterDays` days until it is paid.
    const round = Math.floor(days / reminderAfterDays);
    const participantId = String(row.participantId);
    const key = `overdue:${participantId}:${round}`;

    const created = await notify({
      key,
      type: 'overdue',
      severity: round > 1 ? 'danger' : 'warning',
      title: `${row.name} still owes you ${inr(row.amount)}`,
      message: `It's been ${days} days since "${row.description || row.category}". Time for a friendly reminder.`,
      data: { participantId, transactionId: String(row._id), name: row.name, amount: row.amount, days },
    });
    if (created) {
      await Notification.deleteMany({ type: 'overdue', 'data.participantId': participantId, key: { $ne: key } });
    }
  }
}

async function createMonthEndSummary(month) {
  const key = `month-end:${month}`;
  if (await Notification.exists({ key })) return;

  const [people, status] = await Promise.all([pendingByPerson(), getBudgetStatus(month, { withSuggestion: false })]);
  if (!people.length && !status.spent) return;

  const total = round2(people.reduce((s, p) => s + p.amount, 0));
  const label = monthLabel(month);
  const budgetLine = status.budget?.total
    ? `In ${label} you spent ${inr(status.spent)} of your ${inr(status.budget.total)} budget.`
    : `In ${label} you spent ${inr(status.spent)}.`;

  await notify({
    key,
    type: 'month_end',
    severity: people.length ? 'warning' : 'success',
    title: people.length ? `${label} wrap-up: collect ${inr(total)}` : `${label} wrap-up: all settled`,
    message: people.length
      ? `${budgetLine} Collect ${inr(total)} from ${people.map((p) => `${p.name} (${inr(p.amount)})`).join(', ')}.`
      : `${budgetLine} Nobody owes you anything.`,
    data: {
      month,
      total,
      people: people.map(({ name, amount, count }) => ({ name, amount, count })),
      spent: status.spent,
      budget: status.budget?.total ?? null,
    },
  });
}

export async function checkMonthEnd() {
  const { monthEndReminder } = await getSettings();
  if (!monthEndReminder) return;

  const today = todayISO();
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));

  if (day === daysInMonth(month)) await createMonthEndSummary(month);
  // Catch up if the server was not running on the last day of the previous month.
  else if (day <= 5) await createMonthEndSummary(shiftMonth(month, -1));
}

export async function checkBudgetAlerts(month = currentMonth()) {
  const status = await getBudgetStatus(month, { withSuggestion: false });
  if (!status.budget) return;

  const label = monthLabel(month);
  const targets = [];
  if (status.budget.total > 0) targets.push({ id: 'total', spent: status.spent, limit: status.budget.total });
  for (const c of status.categories) {
    if (c.limit) targets.push({ id: c.category, spent: c.spent, limit: c.limit, fixed: c.fixed });
  }

  for (const t of targets) {
    const pct = (t.spent / t.limit) * 100;
    // Fixed bills normally use their whole limit, so only overspending is worth an alert.
    const level = pct > 100 ? 100 : pct >= 80 && !t.fixed ? 80 : 0;
    if (!level) continue;

    const isTotal = t.id === 'total';
    const name = isTotal ? `your ${label} budget` : `your ${t.id} budget`;
    const left = t.limit - t.spent;
    await notify({
      key: `budget:${month}:${t.id}:${level}`,
      type: 'budget',
      severity: level === 100 ? 'danger' : 'warning',
      title: level === 100 ? `You've crossed ${name}` : `${Math.round(pct)}% of ${name} is used`,
      message:
        level === 100
          ? `Spent ${inr(t.spent)} against ${inr(t.limit)}, that's ${inr(t.spent - t.limit)} over.`
          : `Spent ${inr(t.spent)} of ${inr(t.limit)}. ${left > 0 ? `${inr(left)} left` : 'Nothing left'}${
              isTotal && status.daysLeft ? ` for the next ${status.daysLeft} days` : ''
            }.`,
      data: { month, category: isTotal ? null : t.id, spent: t.spent, limit: t.limit },
    });
  }
}

export async function runAllChecks() {
  for (const check of [checkOverdueSplits, checkMonthEnd, checkBudgetAlerts]) {
    try {
      await check();
    } catch (err) {
      console.error(`Reminder check "${check.name}" failed:`, err.message);
    }
  }
}
