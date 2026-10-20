import mongoose from 'mongoose';
import { SPLIT_REPAYMENT_CATEGORY, Transaction } from '../models/Transaction.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex, round2, startOfDayUTC } from '../utils/helpers.js';
import { assertUsableAccounts } from './account.service.js';

const toId = (id) => new mongoose.Types.ObjectId(id);

async function throwParticipantError(transactionId, participantId, expectPaid) {
  const exists = await Transaction.exists({ _id: transactionId, 'participants._id': participantId });
  if (!exists) throw ApiError.notFound('Split participant not found');
  throw ApiError.conflict(expectPaid ? 'This split is not marked as paid' : 'This split is already marked as paid');
}

/**
 * Marks a participant's share as paid and books the repayment as a credit entry,
 * which raises the balance. The conditional update makes double-payment impossible.
 */
export async function markPaid(transactionId, participantId, { date, paymentMethod, account } = {}) {
  const paidAt = date ? startOfDayUTC(date) : new Date();
  if (account) await assertUsableAccounts([account]);

  const txn = await Transaction.findOneAndUpdate(
    { _id: transactionId, participants: { $elemMatch: { _id: participantId, isPaid: false } } },
    { $set: { 'participants.$.isPaid': true, 'participants.$.paidAt': paidAt } },
    { returnDocument: 'after' },
  );
  if (!txn) await throwParticipantError(transactionId, participantId, false);

  const participant = txn.participants.id(participantId);

  try {
    const settlement = await Transaction.create({
      type: 'credit',
      amount: participant.amount,
      category: SPLIT_REPAYMENT_CATEGORY,
      description: `${participant.name} paid back${txn.description ? ` for ${txn.description}` : ` (${txn.category})`}`.slice(0, 200),
      date: paidAt,
      paymentMethod: paymentMethod ?? txn.paymentMethod,
      // Defaults to the account the bill was paid from.
      account: account === undefined ? txn.account : account,
      settlementOf: { transaction: txn._id, participant: participant._id },
    });

    await Transaction.updateOne(
      { _id: txn._id, 'participants._id': participant._id },
      { $set: { 'participants.$.settlementTxn': settlement._id } },
    );
    participant.settlementTxn = settlement._id;

    return { transaction: txn, settlement };
  } catch (err) {
    await Transaction.updateOne(
      { _id: txn._id, 'participants._id': participant._id },
      { $set: { 'participants.$.isPaid': false, 'participants.$.paidAt': null } },
    );
    throw err;
  }
}

export async function markUnpaid(transactionId, participantId) {
  const txn = await Transaction.findOneAndUpdate(
    { _id: transactionId, participants: { $elemMatch: { _id: participantId, isPaid: true } } },
    {
      $set: {
        'participants.$.isPaid': false,
        'participants.$.paidAt': null,
        'participants.$.settlementTxn': null,
      },
    },
    { returnDocument: 'after' },
  );
  if (!txn) await throwParticipantError(transactionId, participantId, true);

  await Transaction.deleteMany({
    'settlementOf.transaction': toId(transactionId),
    'settlementOf.participant': toId(participantId),
  });

  return { transaction: txn };
}

export async function listSplits({ status, person }) {
  const preMatch = { 'participants.0': { $exists: true } };
  const postMatch = {};

  if (status !== 'all') {
    const isPaid = status === 'paid';
    preMatch.participants = { $elemMatch: { isPaid } };
    postMatch['participants.isPaid'] = isPaid;
  }
  if (person) {
    postMatch['participants.name'] = new RegExp(`^${escapeRegex(person)}$`, 'i');
  }

  const rows = await Transaction.aggregate([
    { $match: preMatch },
    { $unwind: '$participants' },
    ...(Object.keys(postMatch).length ? [{ $match: postMatch }] : []),
    { $sort: { 'participants.isPaid': 1, date: -1, _id: -1 } },
    {
      $project: {
        _id: 0,
        transactionId: '$_id',
        participantId: '$participants._id',
        name: '$participants.name',
        amount: '$participants.amount',
        isPaid: '$participants.isPaid',
        paidAt: '$participants.paidAt',
        settlementTxn: '$participants.settlementTxn',
        description: 1,
        category: 1,
        date: 1,
        account: 1,
        totalAmount: '$amount',
      },
    },
  ]);

  const totals = rows.reduce(
    (acc, r) => {
      acc[r.isPaid ? 'paid' : 'pending'] += r.amount;
      return acc;
    },
    { pending: 0, paid: 0 },
  );

  return { items: rows, totals: { pending: round2(totals.pending), paid: round2(totals.paid) } };
}

/**
 * Everyone I share money with. `pending` is what they still owe me, `owe` what I still owe them,
 * and `net` = pending − owe (positive: they pay me, negative: I pay them), like PhonePe/Splitwise.
 */
export async function listPeople() {
  const [shares, debts] = await Promise.all([
    Transaction.aggregate([
      { $match: { 'participants.0': { $exists: true } } },
      { $unwind: '$participants' },
      {
        $group: {
          _id: { $toLower: '$participants.name' },
          name: { $first: '$participants.name' },
          total: { $sum: '$participants.amount' },
          paid: { $sum: { $cond: ['$participants.isPaid', '$participants.amount', 0] } },
          pendingCount: { $sum: { $cond: ['$participants.isPaid', 0, 1] } },
          count: { $sum: 1 },
          lastActivity: { $max: '$date' },
        },
      },
    ]),
    Transaction.aggregate([
      { $match: { 'owedTo.name': { $exists: true } } },
      {
        $group: {
          _id: { $toLower: '$owedTo.name' },
          name: { $first: '$owedTo.name' },
          oweTotal: { $sum: '$amount' },
          owe: { $sum: { $cond: ['$owedTo.isPaid', 0, '$amount'] } },
          oweCount: { $sum: { $cond: ['$owedTo.isPaid', 0, 1] } },
          lastActivity: { $max: '$date' },
        },
      },
    ]),
  ]);

  const people = new Map();
  for (const s of shares) {
    people.set(s._id, { name: s.name, total: s.total, paid: s.paid, pendingCount: s.pendingCount, count: s.count, lastActivity: s.lastActivity });
  }
  for (const d of debts) {
    const p = people.get(d._id) ?? { name: d.name, total: 0, paid: 0, pendingCount: 0, count: 0, lastActivity: null };
    people.set(d._id, {
      ...p,
      oweTotal: d.oweTotal,
      owe: d.owe,
      oweCount: d.oweCount,
      lastActivity: [p.lastActivity, d.lastActivity].filter(Boolean).sort((a, b) => b - a)[0],
    });
  }

  return [...people.values()]
    .map(({ total, paid, owe = 0, oweTotal = 0, oweCount = 0, ...rest }) => {
      const pending = round2(total - paid);
      return {
        ...rest,
        total: round2(total),
        paid: round2(paid),
        pending,
        owe: round2(owe),
        oweTotal: round2(oweTotal),
        oweCount,
        net: round2(pending - owe),
      };
    })
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.pending - a.pending || a.name.localeCompare(b.name));
}

const personRx = (name) => new RegExp(`^${escapeRegex(name.trim())}$`, 'i');

/** Entries someone else paid for, where I owe them my share. */
export async function listDebts({ status = 'pending', person } = {}) {
  const filter = { 'owedTo.name': person ? personRx(person) : { $exists: true } };
  if (status !== 'all') filter['owedTo.isPaid'] = status === 'paid';
  const rows = await Transaction.find(filter).sort({ 'owedTo.isPaid': 1, date: -1, _id: -1 }).lean();
  const items = rows.map((t) => ({
    transactionId: t._id,
    name: t.owedTo.name,
    amount: t.amount,
    isPaid: t.owedTo.isPaid,
    paidAt: t.owedTo.paidAt,
    description: t.description,
    category: t.category,
    date: t.date,
    account: t.account,
  }));
  const totals = items.reduce(
    (acc, r) => {
      acc[r.isPaid ? 'paid' : 'pending'] += r.amount;
      return acc;
    },
    { pending: 0, paid: 0 },
  );
  return { items, totals: { pending: round2(totals.pending), paid: round2(totals.paid) } };
}

/** I paid the person back: the money now leaves `account` (defaults to the entry's account). */
export async function payDebt(transactionId, { date, paymentMethod, account } = {}) {
  if (account) await assertUsableAccounts([account]);
  const txn = await Transaction.findOneAndUpdate(
    { _id: transactionId, 'owedTo.isPaid': false },
    {
      $set: {
        'owedTo.isPaid': true,
        'owedTo.paidAt': date ? startOfDayUTC(date) : new Date(),
        ...(account !== undefined ? { account } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
      },
    },
    { returnDocument: 'after' },
  );
  if (!txn) {
    const exists = await Transaction.exists({ _id: transactionId, owedTo: { $exists: true } });
    if (!exists) throw ApiError.notFound('Nothing owed on this entry');
    throw ApiError.conflict('Already marked as paid back');
  }
  return { transaction: txn };
}

export async function unpayDebt(transactionId) {
  const txn = await Transaction.findOneAndUpdate(
    { _id: transactionId, 'owedTo.isPaid': true },
    { $set: { 'owedTo.isPaid': false, 'owedTo.paidAt': null } },
    { returnDocument: 'after' },
  );
  if (!txn) {
    const exists = await Transaction.exists({ _id: transactionId, owedTo: { $exists: true } });
    if (!exists) throw ApiError.notFound('Nothing owed on this entry');
    throw ApiError.conflict('This is not marked as paid back');
  }
  return { transaction: txn };
}

/**
 * Settles everything between me and one person in one go, netting both sides:
 * their pending shares are booked as repayments into `account` and my debts to them are paid
 * from the same account, so only the difference actually moves (they owe 100, I owe 50 → +50).
 */
export async function settleUp(name, { date, account } = {}) {
  if (account) await assertUsableAccounts([account]);
  const [{ items: shares }, { items: debts }] = await Promise.all([
    listSplits({ status: 'pending', person: name }),
    listDebts({ status: 'pending', person: name }),
  ]);
  if (!shares.length && !debts.length) throw ApiError.badRequest(`Nothing to settle with ${name}`);

  const into = account === undefined ? {} : { account };
  for (const s of shares) await markPaid(String(s.transactionId), String(s.participantId), { date, ...into });
  for (const d of debts) await payDebt(String(d.transactionId), { date, ...into });

  const received = round2(shares.reduce((s, r) => s + r.amount, 0));
  const paid = round2(debts.reduce((s, r) => s + r.amount, 0));
  return {
    name: shares[0]?.name ?? debts[0]?.name ?? name,
    received,
    paid,
    net: round2(received - paid),
    shares: shares.map((s) => String(s.participantId)),
    debts: debts.length,
  };
}
