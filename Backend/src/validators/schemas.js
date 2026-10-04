import { z } from 'zod';
import { PAYMENT_METHODS, TRANSACTION_TYPES } from '../models/Transaction.js';
import { ACCOUNT_COLORS, ACCOUNT_TYPES } from '../models/Account.js';
import { LOCK_METHODS } from '../models/Auth.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const accountRef = objectId.nullable();

const money = z.coerce
  .number({ error: 'Amount must be a number' })
  .positive('Amount must be greater than 0')
  .max(1e10, 'Amount is too large')
  .transform((v) => Math.round(v * 100) / 100);

const optionalDate = z.coerce.date({ error: 'Invalid date' }).optional();

const participantInput = z.object({
  _id: objectId.optional(),
  name: z.string().trim().min(1, 'Participant name is required').max(60),
  amount: money,
});

const transactionBase = z.object({
  type: z.enum(TRANSACTION_TYPES),
  amount: money,
  category: z.string().trim().min(1, 'Category is required').max(40),
  description: z.string().trim().max(200).optional(),
  date: optionalDate,
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  account: accountRef.optional(),
  toAccount: accountRef.optional(),
  participants: z.array(participantInput).max(50).optional(),
});

export const createTransactionSchema = transactionBase.superRefine((data, ctx) => {
  const participants = data.participants ?? [];
  if (data.type === 'transfer') {
    if (!data.account) ctx.addIssue({ code: 'custom', path: ['account'], message: 'Pick the account the money leaves' });
    if (!data.toAccount) ctx.addIssue({ code: 'custom', path: ['toAccount'], message: 'Pick the account the money goes to' });
    if (data.account && data.account === data.toAccount) {
      ctx.addIssue({ code: 'custom', path: ['toAccount'], message: 'Choose two different accounts' });
    }
  }
  if (!participants.length) return;
  if (data.type !== 'debit') {
    ctx.addIssue({ code: 'custom', path: ['participants'], message: 'Only debit transactions can be split' });
  }
  const splitTotal = participants.reduce((sum, p) => sum + p.amount, 0);
  if (splitTotal - data.amount > 0.001) {
    ctx.addIssue({ code: 'custom', path: ['participants'], message: 'Split total cannot exceed the transaction amount' });
  }
});

export const updateTransactionSchema = transactionBase
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' });

export const idParamSchema = z.object({ id: objectId });

export const listQuerySchema = z.object({
  type: z.enum(TRANSACTION_TYPES).optional(),
  category: z.string().trim().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  from: optionalDate,
  to: optionalDate,
  split: z.enum(['true', 'false']).optional(),
  account: z.union([objectId, z.literal('none')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['date', '-date', 'amount', '-amount']).default('-date'),
});

export const summaryQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  months: z.coerce.number().int().min(1).max(24).default(6),
});

export const splitListQuerySchema = z.object({
  status: z.enum(['pending', 'paid', 'all']).default('all'),
  person: z.string().trim().max(60).optional(),
});

export const participantParamSchema = z.object({
  transactionId: objectId,
  participantId: objectId,
});

export const monthParamSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM'),
});

const limitAmount = z.coerce.number().min(0, 'Limit cannot be negative').max(1e10).transform((v) => Math.round(v * 100) / 100);

export const budgetBodySchema = z
  .object({
    total: limitAmount,
    categories: z
      .array(z.object({ category: z.string().trim().min(1, 'Category is required').max(40), limit: limitAmount }))
      .max(50)
      .default([]),
  })
  .refine((b) => new Set(b.categories.map((c) => c.category.toLowerCase())).size === b.categories.length, {
    message: 'Each category can only have one limit',
    path: ['categories'],
  });

export const notificationQuerySchema = z.object({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const settingsBodySchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    reminderAfterDays: z.coerce.number().int().min(1).max(60),
    monthEndReminder: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' });

export const payBodySchema = z.object({
  date: optionalDate,
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  account: accountRef.optional(),
});

const accountFields = z.object({
  name: z.string().trim().min(1, 'Account name is required').max(40),
  type: z.enum(ACCOUNT_TYPES),
  openingBalance: z.coerce
    .number({ error: 'Opening balance must be a number' })
    .min(-1e10)
    .max(1e10)
    .transform((v) => Math.round(v * 100) / 100),
  color: z.enum(ACCOUNT_COLORS),
  isDefault: z.boolean(),
  archived: z.boolean(),
});

export const createAccountSchema = accountFields
  .omit({ archived: true })
  .partial({ type: true, openingBalance: true, color: true, isDefault: true });

// Patterns are 3×3 dot indexes (0–8) joined by commas, each dot used at most once.
const isValidSecret = (method, secret) => {
  if (method === 'pin') return /^\d{4,8}$/.test(secret);
  if (!/^[0-8](,[0-8]){3,8}$/.test(secret)) return false;
  const dots = secret.split(',');
  return new Set(dots).size === dots.length;
};

const secretIssue = (method) =>
  method === 'pin' ? 'PIN must be 4 to 8 digits' : 'Connect at least 4 dots, each dot only once';

const checkSecret = (d, ctx) => {
  if (!isValidSecret(d.method, d.secret)) ctx.addIssue({ code: 'custom', path: ['secret'], message: secretIssue(d.method) });
};

const newSecret = { method: z.enum(LOCK_METHODS), secret: z.string().max(40) };

export const setupLockSchema = z.object(newSecret).superRefine(checkSecret);

export const unlockSchema = z.object({ secret: z.string().min(1, 'Enter your PIN or pattern').max(40) });

export const updateLockSchema = z
  .object({ ...newSecret, currentSecret: z.string().min(1, 'Confirm your current PIN or pattern').max(40) })
  .superRefine(checkSecret);

export const removeLockSchema = z.object({ currentSecret: z.string().min(1, 'Confirm your current PIN or pattern').max(40) });

export const updateAccountSchema = accountFields
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' });
