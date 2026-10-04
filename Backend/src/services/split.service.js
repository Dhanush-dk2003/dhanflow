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

export async function listPeople() {
  const rows = await Transaction.aggregate([
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
    { $addFields: { pending: { $subtract: ['$total', '$paid'] } } },
    { $sort: { pending: -1, name: 1 } },
  ]);

  return rows.map(({ _id, total, paid, pending, ...rest }) => ({
    ...rest,
    total: round2(total),
    paid: round2(paid),
    pending: round2(pending),
  }));
}
