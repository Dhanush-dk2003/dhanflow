import { Account } from '../models/Account.js';
import { Transaction } from '../models/Transaction.js';
import { dateRangeMatch, round2 } from '../utils/helpers.js';
import { isDebit, isIncome, isRepayment, myShareExpr, sumIf } from '../utils/expressions.js';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildTrend(rows, months) {
  const byKey = new Map(rows.map((r) => [`${r._id.y}-${r._id.m}`, r]));
  const now = new Date();
  const trend = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const row = byKey.get(`${y}-${m}`);
    trend.push({
      month: `${y}-${String(m).padStart(2, '0')}`,
      label: `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`,
      income: round2(row?.income),
      repayments: round2(row?.repayments),
      spent: round2(row?.spent),
      myShare: round2(row?.myShare),
    });
  }
  return trend;
}

export async function getSummary({ from, to, months }) {
  const range = dateRangeMatch(from, to);
  const now = new Date();
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  const [allTime, [opening], [period], [pending], byCategory, trendRows, recent] = await Promise.all([
    Transaction.aggregate([
      { $match: { type: { $in: ['credit', 'debit'] } } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),

    Account.aggregate([{ $group: { _id: null, total: { $sum: '$openingBalance' } } }]),

    Transaction.aggregate([
      { $match: range },
      {
        $group: {
          _id: null,
          income: sumIf(isIncome),
          repayments: sumIf(isRepayment),
          spent: sumIf(isDebit),
          myShare: sumIf(isDebit, myShareExpr),
          count: sumIf({ $ne: ['$type', 'transfer'] }, 1),
        },
      },
    ]),

    Transaction.aggregate([
      { $match: { participants: { $elemMatch: { isPaid: false } } } },
      { $unwind: '$participants' },
      { $match: { 'participants.isPaid': false } },
      {
        $group: {
          _id: null,
          total: { $sum: '$participants.amount' },
          count: { $sum: 1 },
          people: { $addToSet: { $toLower: '$participants.name' } },
        },
      },
    ]),

    Transaction.aggregate([
      { $match: { ...range, type: 'debit' } },
      {
        $group: {
          _id: '$category',
          spent: { $sum: '$amount' },
          myShare: { $sum: myShareExpr },
          count: { $sum: 1 },
        },
      },
      { $sort: { myShare: -1 } },
    ]),

    Transaction.aggregate([
      { $match: { date: { $gte: trendStart } } },
      {
        $group: {
          _id: { y: { $year: '$date' }, m: { $month: '$date' } },
          income: sumIf(isIncome),
          repayments: sumIf(isRepayment),
          spent: sumIf(isDebit),
          myShare: sumIf(isDebit, myShareExpr),
        },
      },
    ]),

    Transaction.find().sort({ date: -1, _id: -1 }).limit(6).lean(),
  ]);

  const totals = { credit: 0, debit: 0 };
  for (const row of allTime) totals[row._id] = round2(row.total);

  const categoryTotal = byCategory.reduce((sum, c) => sum + c.myShare, 0);

  return {
    balance: round2((opening?.total ?? 0) + totals.credit - totals.debit),
    totals,
    period: {
      income: round2(period?.income),
      repayments: round2(period?.repayments),
      spent: round2(period?.spent),
      myShare: round2(period?.myShare),
      net: round2((period?.income ?? 0) + (period?.repayments ?? 0) - (period?.spent ?? 0)),
      count: period?.count ?? 0,
    },
    pending: {
      total: round2(pending?.total),
      count: pending?.count ?? 0,
      people: pending?.people?.length ?? 0,
    },
    byCategory: byCategory.map((c) => ({
      category: c._id,
      spent: round2(c.spent),
      myShare: round2(c.myShare),
      count: c.count,
      percent: categoryTotal ? round2((c.myShare / categoryTotal) * 100) : 0,
    })),
    trend: buildTrend(trendRows, months),
    recent,
  };
}

export async function getCategories() {
  const [debit, credit] = await Promise.all([
    Transaction.distinct('category', { type: 'debit' }),
    Transaction.distinct('category', { type: 'credit' }),
  ]);
  return { debit, credit };
}
