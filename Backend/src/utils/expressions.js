// Reusable MongoDB aggregation expressions for transaction documents.

export const isRepayment = { $gt: ['$settlementOf.transaction', null] };
export const isDebit = { $eq: ['$type', 'debit'] };
export const isIncome = { $and: [{ $eq: ['$type', 'credit'] }, { $not: [isRepayment] }] };

// What I personally spent on a debit: the full amount minus everyone else's share.
export const myShareExpr = {
  $subtract: ['$amount', { $sum: { $ifNull: ['$participants.amount', []] } }],
};

export const sumIf = (cond, value = '$amount') => ({ $sum: { $cond: [cond, value, 0] } });
