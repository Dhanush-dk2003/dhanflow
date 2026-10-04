import mongoose from 'mongoose';
import { TRANSFER_CATEGORY, Transaction } from '../models/Transaction.js';
import { ApiError } from '../utils/ApiError.js';
import { dateRangeMatch, escapeRegex, round2 } from '../utils/helpers.js';
import { assertUsableAccounts, getDefaultAccountId } from './account.service.js';

const accountObjectId = (account) =>
  account && account !== 'none' ? new mongoose.Types.ObjectId(account) : null;

// ObjectIds (not strings) because the filter is also used in aggregations, which don't cast.
export function buildFilter({ type, category, search, from, to, split, account } = {}) {
  const filter = { ...dateRangeMatch(from, to) };
  const and = [];
  if (type) filter.type = type;
  if (category) filter.category = category;
  if (split === 'true') filter['participants.0'] = { $exists: true };
  if (split === 'false') filter['participants.0'] = { $exists: false };
  if (account === 'none') filter.account = null;
  else if (account) {
    const id = accountObjectId(account);
    and.push({ $or: [{ account: id }, { toAccount: id }] });
  }
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    and.push({ $or: [{ description: rx }, { category: rx }, { 'participants.name': rx }] });
  }
  if (and.length) filter.$and = and;
  return filter;
}

/**
 * `in`/`out` are flows for the selected account (transfers count on the side they
 * touch). Without an account filter, transfers are internal and only credit/debit count.
 */
async function computeTotals(filter, account) {
  const accountId = accountObjectId(account);
  const rows = await Transaction.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { type: '$type', incoming: accountId ? { $eq: ['$toAccount', accountId] } : { $literal: false } },
        total: { $sum: '$amount' },
      },
    },
  ]);

  const totals = { credit: 0, debit: 0, transfer: 0, in: 0, out: 0 };
  for (const { _id, total } of rows) {
    if (_id.type === 'transfer') {
      totals.transfer += total;
      if (accountId) totals[_id.incoming ? 'in' : 'out'] += total;
    } else {
      totals[_id.type] += total;
      totals[_id.type === 'credit' ? 'in' : 'out'] += total;
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)]));
}

export function sortSpec(sort = '-date') {
  const dir = sort.startsWith('-') ? -1 : 1;
  return { [sort.replace('-', '')]: dir, _id: dir };
}

export async function listTransactions(query) {
  const { page, limit, sort } = query;
  const filter = buildFilter(query);

  const [items, total, totals] = await Promise.all([
    Transaction.find(filter)
      .sort(sortSpec(sort))
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
    computeTotals(filter, query.account),
  ]);

  return {
    items,
    totals,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getTransaction(id) {
  const txn = await Transaction.findById(id).lean();
  if (!txn) throw ApiError.notFound('Transaction not found');
  return txn;
}

export async function createTransaction({ participants = [], ...data }) {
  if (data.type === 'transfer') {
    data.category = TRANSFER_CATEGORY;
  } else {
    delete data.toAccount;
    if (data.account === undefined) data.account = await getDefaultAccountId();
  }
  await assertUsableAccounts([data.account, data.toAccount]);

  return Transaction.create({
    ...data,
    participants: participants.map(({ name, amount }) => ({ name, amount })),
  });
}

/**
 * Paid participants are locked: they always survive an edit unchanged, because
 * their repayment has already been booked as a credit entry.
 */
function mergeParticipants(existing, incoming) {
  const paid = existing.filter((p) => p.isPaid);
  const paidIds = new Set(paid.map((p) => p.id));
  const existingIds = new Set(existing.map((p) => p.id));

  const pending = incoming
    .filter((p) => !p._id || !paidIds.has(p._id))
    .map(({ _id, name, amount }) => ({
      ...(_id && existingIds.has(_id) ? { _id } : {}),
      name,
      amount,
    }));

  return [...paid.map((p) => p.toObject()), ...pending];
}

export async function updateTransaction(id, { participants, ...fields }) {
  const txn = await Transaction.findById(id);
  if (!txn) throw ApiError.notFound('Transaction not found');
  if (txn.settlementOf?.transaction) {
    throw ApiError.badRequest('Repayment entries are managed from Splits. Mark the split as unpaid instead.');
  }

  // Old entries may point at an archived account; only newly chosen accounts must be usable.
  const changedAccounts = ['account', 'toAccount'].filter(
    (key) => fields[key] && String(fields[key]) !== String(txn[key] ?? ''),
  );
  await assertUsableAccounts(changedAccounts.map((key) => fields[key]));

  txn.set(fields);
  if (participants) txn.participants = mergeParticipants(txn.participants, participants);

  if (txn.type === 'transfer') {
    if (!txn.account || !txn.toAccount) throw ApiError.badRequest('Pick both accounts for a transfer');
    if (String(txn.account) === String(txn.toAccount)) throw ApiError.badRequest('Choose two different accounts');
    if (txn.participants.length) throw ApiError.badRequest('Transfers cannot be split');
    txn.category = TRANSFER_CATEGORY;
  } else {
    txn.toAccount = undefined;
  }

  if (txn.participants.length) {
    if (txn.type !== 'debit') throw ApiError.badRequest('Only debit transactions can be split');
    const splitTotal = txn.participants.reduce((sum, p) => sum + p.amount, 0);
    if (splitTotal - txn.amount > 0.001) {
      throw ApiError.badRequest('Split total cannot exceed the transaction amount');
    }
  }

  await txn.save();
  return txn;
}

export async function deleteTransaction(id) {
  const txn = await Transaction.findByIdAndDelete(id).lean();
  if (!txn) throw ApiError.notFound('Transaction not found');

  if (txn.settlementOf?.transaction) {
    // Deleting a repayment re-opens the participant's debt.
    await Transaction.updateOne(
      { _id: txn.settlementOf.transaction, 'participants._id': txn.settlementOf.participant },
      {
        $set: {
          'participants.$.isPaid': false,
          'participants.$.paidAt': null,
          'participants.$.settlementTxn': null,
        },
      },
    );
  } else if (txn.participants?.length) {
    await Transaction.deleteMany({ 'settlementOf.transaction': txn._id });
  }

  return txn;
}