import mongoose from 'mongoose';
import { Account } from '../models/Account.js';
import { Transaction } from '../models/Transaction.js';
import { ApiError } from '../utils/ApiError.js';
import { currentMonth, monthBounds } from '../utils/dates.js';
import { escapeRegex, round2 } from '../utils/helpers.js';
import { sumIf } from '../utils/expressions.js';

const typeIs = (type) => ({ $eq: ['$type', type] });

/** Rejects ids that don't exist, or that point at an archived account. */
export async function assertUsableAccounts(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return;
  const found = await Account.find({ _id: { $in: unique } }, { name: 1, archived: 1 }).lean();
  if (found.length !== unique.length) throw ApiError.badRequest('Account not found');
  const archived = found.find((a) => a.archived);
  if (archived) throw ApiError.badRequest(`${archived.name} is archived. Restore it to use it again`);
}

export async function getDefaultAccountId() {
  const account = await Account.findOne({ isDefault: true, archived: false }, { _id: 1 }).lean();
  return account?._id ?? null;
}

async function assertUniqueName(name, exceptId) {
  const clash = await Account.findOne({
    name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).lean();
  if (clash) throw ApiError.conflict(`You already have an account called ${clash.name}`);
}

async function promoteDefault(exceptId) {
  const next = await Account.findOne({ archived: false, _id: { $ne: exceptId } }).sort({ createdAt: 1 });
  if (next) {
    next.isDefault = true;
    await next.save();
  }
}

/**
 * Balance = opening balance + credits − debits − transfers out + transfers in.
 * Entries without an account are reported separately as `unassigned`, so the
 * overall `total` always matches the dashboard balance.
 */
export async function listAccounts() {
  const { start, end } = monthBounds(currentMonth());
  const inMonth = { $and: [{ $gte: ['$date', start] }, { $lt: ['$date', end] }] };

  const [accounts, outgoing, incoming] = await Promise.all([
    Account.find().sort({ archived: 1, isDefault: -1, createdAt: 1 }).lean(),
    Transaction.aggregate([
      {
        $group: {
          _id: '$account',
          credit: sumIf(typeIs('credit')),
          debit: sumIf(typeIs('debit')),
          transferOut: sumIf(typeIs('transfer')),
          monthIn: sumIf({ $and: [typeIs('credit'), inMonth] }),
          monthOut: sumIf({ $and: [typeIs('debit'), inMonth] }),
          count: { $sum: 1 },
          lastUsed: { $max: '$date' },
        },
      },
    ]),
    Transaction.aggregate([
      { $match: { type: 'transfer' } },
      { $group: { _id: '$toAccount', transferIn: { $sum: '$amount' }, count: { $sum: 1 }, lastUsed: { $max: '$date' } } },
    ]),
  ]);

  const outBy = new Map(outgoing.map((r) => [String(r._id), r]));
  const inBy = new Map(incoming.map((r) => [String(r._id), r]));

  const items = accounts.map((a) => {
    const o = outBy.get(String(a._id)) ?? {};
    const i = inBy.get(String(a._id)) ?? {};
    const lastUsed = [o.lastUsed, i.lastUsed].filter(Boolean).sort((x, y) => y - x)[0] ?? null;
    return {
      ...a,
      balance: round2(a.openingBalance + (o.credit ?? 0) - (o.debit ?? 0) - (o.transferOut ?? 0) + (i.transferIn ?? 0)),
      monthIn: round2(o.monthIn),
      monthOut: round2(o.monthOut),
      count: (o.count ?? 0) + (i.count ?? 0),
      lastUsed,
    };
  });

  const loose = outBy.get('null');
  const unassigned = loose?.count
    ? { balance: round2((loose.credit ?? 0) - (loose.debit ?? 0)), count: loose.count }
    : null;

  const total = round2(items.reduce((s, a) => s + a.balance, 0) + (unassigned?.balance ?? 0));
  return { accounts: items, unassigned, total };
}

export async function createAccount({ isDefault, ...data }) {
  await assertUniqueName(data.name);
  const hasDefault = await Account.exists({ isDefault: true, archived: false });
  const makeDefault = isDefault || !hasDefault;
  if (makeDefault) await Account.updateMany({ isDefault: true }, { $set: { isDefault: false } });
  return Account.create({ ...data, isDefault: makeDefault });
}

export async function updateAccount(id, data) {
  const account = await Account.findById(id);
  if (!account) throw ApiError.notFound('Account not found');
  if (data.name) await assertUniqueName(data.name, id);

  const archiving = data.archived === true && !account.archived;
  if (data.isDefault && (data.archived ?? account.archived)) {
    throw ApiError.badRequest('An archived account cannot be the default');
  }
  if (data.isDefault) await Account.updateMany({ _id: { $ne: id }, isDefault: true }, { $set: { isDefault: false } });

  const wasDefault = account.isDefault;
  account.set(data);
  if (archiving) account.isDefault = false;
  if (data.isDefault === false && wasDefault) account.isDefault = false;
  await account.save();

  if (wasDefault && !account.isDefault) await promoteDefault(id);
  else if (data.archived === false && !(await Account.exists({ isDefault: true, archived: false }))) {
    account.isDefault = true;
    await account.save();
  }
  return account;
}

export async function deleteAccount(id) {
  const account = await Account.findById(id).lean();
  if (!account) throw ApiError.notFound('Account not found');

  const used = await Transaction.countDocuments({ $or: [{ account: id }, { toAccount: id }] });
  if (used) {
    throw ApiError.conflict(
      `${account.name} has ${used} ${used === 1 ? 'entry' : 'entries'}. Archive it instead to keep your history`,
    );
  }

  await Account.deleteOne({ _id: id });
  if (account.isDefault) await promoteDefault(id);
}

/** Links every entry that has no account (from before accounts existed) to this one. */
export async function assignUnassigned(id) {
  await assertUsableAccounts([id]);
  const { modifiedCount } = await Transaction.updateMany(
    { account: null, type: { $ne: 'transfer' } },
    { $set: { account: new mongoose.Types.ObjectId(id) } },
  );
  return { moved: modifiedCount };
}

export async function accountNames() {
  const accounts = await Account.find({}, { name: 1 }).lean();
  return new Map(accounts.map((a) => [String(a._id), a.name]));
}
