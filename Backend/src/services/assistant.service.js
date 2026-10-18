import { z, ZodError } from 'zod';
import { ACCOUNT_COLORS, ACCOUNT_TYPES, Account } from '../models/Account.js';
import { Budget } from '../models/Budget.js';
import { PAYMENT_METHODS, TRANSFER_CATEGORY, Transaction } from '../models/Transaction.js';
import { chatCompletion } from './ai.service.js';
import { getSummary } from './summary.service.js';
import { buildFilter, createTransaction, getTransaction, listTransactions, updateTransaction } from './transaction.service.js';
import { accountNames, createAccount, getDefaultAccountId, listAccounts, updateAccount } from './account.service.js';
import { listPeople, listSplits, markPaid, markUnpaid } from './split.service.js';
import { findEffectiveBudget, getBudgetStatus, saveBudget } from './budget.service.js';
import { getSettings, updateSettings } from './settings.service.js';
import { categorizeRows, categoryOptions } from './categorize.service.js';
import { checkBudgetAlerts, listNotifications, markAllRead, resolveOverdue, runAllChecks } from './notification.service.js';
import { Notification } from '../models/Notification.js';
import { CHART_GROUPS, CHART_METRICS, CHART_TYPES, buildChart } from './chart.service.js';
import { REPORTS, REPORT_LABELS, buildReport } from './report.service.js';
import { EXPORT_FORMATS } from './report.export.js';
import { merchantKey } from './statement.parser.js';
import {
  budgetBodySchema,
  createAccountSchema,
  createTransactionSchema,
  settingsBodySchema,
  updateAccountSchema,
  updateTransactionSchema,
} from '../validators/schemas.js';
import { ApiError } from '../utils/ApiError.js';
import { dateRangeMatch, escapeRegex, round2 } from '../utils/helpers.js';
import { isDebit, isIncome, isRepayment, myShareExpr, sumIf } from '../utils/expressions.js';
import { currentMonth, shiftMonth, todayISO } from '../utils/dates.js';

const MAX_STEPS = 8;
const MAX_TOOL_RESULT_CHARS = 24_000;
const MAX_NEW_ENTRIES = 50;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const entryId = z.string().regex(/^[a-f\d]{24}$/i, 'Not an entry id');
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const range = { from: isoDate.optional(), to: isoDate.optional() };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);

const dateParam = (what) => ({ type: 'string', description: `${what}, YYYY-MM-DD` });
const APP_PAGES = ['home', 'activity', 'accounts', 'collect', 'budget', 'import'];
const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const TOOLS = [
  fn(
    'get_overview',
    'Totals for a period: income, spending (spent = full amount paid, myShare = after friends pay back their split), net, entry count, spending by category, money friends still owe, and current overall balance.',
    { from: dateParam('Start date'), to: dateParam('End date') },
    ['from', 'to'],
  ),
  fn(
    'find_transactions',
    'Search individual entries. Use for biggest expenses, payments to a person or shop, a category, or listing what happened on some days.',
    {
      from: dateParam('Start date'),
      to: dateParam('End date'),
      type: { type: 'string', enum: ['debit', 'credit', 'transfer'], description: 'debit = money out, credit = money in, transfer = between my own accounts' },
      category: { type: 'string', description: 'Exact category name, e.g. Food' },
      search: { type: 'string', description: 'Text to find in the description, category or split participants' },
      account: { type: 'string', description: 'Account name' },
      sort: { type: 'string', enum: ['-amount', 'amount', '-date', 'date'], description: '-amount = biggest first, -date = newest first' },
      limit: { type: 'integer', description: 'How many entries to return, 1-50 (default 20)' },
    },
  ),
  fn(
    'spending_over_time',
    'Income and spending grouped by day, week or month. Use to compare periods or spot trends.',
    { from: dateParam('Start date'), to: dateParam('End date'), group_by: { type: 'string', enum: ['day', 'week', 'month'] } },
    ['from', 'to', 'group_by'],
  ),
  fn(
    'top_payees',
    'Where money went (or came from) most in a period, grouped by description, with totals and counts.',
    {
      from: dateParam('Start date'),
      to: dateParam('End date'),
      type: { type: 'string', enum: ['debit', 'credit'], description: 'debit (default) = spending, credit = income' },
      limit: { type: 'integer', description: '1-30 (default 10)' },
    },
  ),
  fn('list_accounts', 'All accounts (bank, cash, wallet, card) with current balance and this month in/out.'),
  fn('money_owed_to_me', 'Friends who still owe money from split expenses: pending total per person and each unpaid share (entry id, what it was for, date, amount).'),
  fn(
    'budget_status',
    'Budget for a month: total limit, spent, remaining, projected month-end spend, safe daily spend, and per-category limits.',
    { month: { type: 'string', description: 'YYYY-MM' } },
    ['month'],
  ),
  fn(
    'add_entries',
    'Save new entries. Only call when every entry has an amount and what it was for (description or category); transfers need the account the money goes to. Up to 50 at once. Never use this for a friend paying back a split: use collect_split.',
    {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['debit', 'credit', 'transfer'],
              description: 'debit = money out (spent, paid), credit = money in (received, earned), transfer = moved between my own accounts',
            },
            amount: { type: 'number', description: 'Rupees, positive' },
            description: { type: 'string', description: 'What it was for or who it was with, e.g. "Petrol" or "Lunch with Ravi"' },
            category: { type: 'string', description: 'One of the listed categories. Leave out to let DhanFlow pick from past entries' },
            date: dateParam('Day it happened (default today)'),
            account: { type: 'string', description: 'Account name (default account if left out). For a transfer: the account the money leaves' },
            to_account: { type: 'string', description: 'Transfers only: the account the money goes to' },
            payment_method: { type: 'string', enum: PAYMENT_METHODS },
            split_with: {
              type: 'array',
              description: "Friends who owe part of a debit: each person's share",
              items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' } }, required: ['name', 'amount'] },
            },
            not_split_repayment: {
              type: 'boolean',
              description: 'Only set after the app warned that this person has a pending split and the user confirmed this money is unrelated to it',
            },
          },
          required: ['type', 'amount'],
        },
      },
    },
    ['entries'],
  ),
  fn(
    'update_entry',
    'Change one saved entry. Get its id from find_transactions (or from an earlier [Added …] note). Send only the fields that change.',
    {
      id: { type: 'string', description: 'Entry id' },
      type: { type: 'string', enum: ['debit', 'credit', 'transfer'] },
      amount: { type: 'number' },
      description: { type: 'string' },
      category: { type: 'string' },
      date: dateParam('New date'),
      account: { type: 'string', description: 'Account name' },
      to_account: { type: 'string', description: 'Transfers only: account the money goes to' },
      payment_method: { type: 'string', enum: PAYMENT_METHODS },
      split_with: {
        type: 'array',
        description:
          'Debits only: the full new list of friends who owe a share (replaces the unpaid ones; people who already paid back always stay). Empty list = no split.',
        items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' } }, required: ['name', 'amount'] },
      },
    },
    ['id'],
  ),
  fn(
    'collect_split',
    "Record a friend paying back their share of a split expense, exactly like pressing Mark paid on the Splits page: the share is marked paid and a Split Repayment entry (money in) is added. Pick shares with entry_id, amount (whole shares adding up to it) or all.",
    {
      person: { type: 'string', description: 'Who paid back' },
      amount: { type: 'number', description: 'Rupees they paid, if said' },
      entry_id: { type: 'string', description: 'The split expense this repays, if known (from money_owed_to_me)' },
      all: { type: 'boolean', description: 'They paid back everything they owe' },
      date: dateParam('Day they paid (default today)'),
      account: { type: 'string', description: 'Account the money came into (default: the account the bill was paid from)' },
      payment_method: { type: 'string', enum: PAYMENT_METHODS },
    },
    ['person'],
  ),
  fn(
    'reopen_split',
    'Undo a recorded repayment: mark a share as not paid again and remove its Split Repayment entry, like Mark unpaid on the Splits page.',
    {
      person: { type: 'string' },
      entry_id: { type: 'string', description: 'The split expense, if known' },
      amount: { type: 'number', description: 'Amount of the share, if said' },
    },
    ['person'],
  ),
  fn(
    'set_budget',
    "Set or change the monthly budget, like the Budget page. Send only what changes; other category limits stay. A month's budget also applies to later months until changed.",
    {
      month: { type: 'string', description: 'YYYY-MM (default this month)' },
      total: { type: 'number', description: 'Total monthly limit in rupees' },
      categories: {
        type: 'array',
        description: 'Category limits to add or change',
        items: { type: 'object', properties: { category: { type: 'string' }, limit: { type: 'number' } }, required: ['category', 'limit'] },
      },
      remove_categories: { type: 'array', items: { type: 'string' }, description: 'Categories whose limit should be removed' },
    },
  ),
  fn(
    'add_account',
    'Create an account (bank, cash, wallet, card, other), like the Accounts page.',
    {
      name: { type: 'string' },
      type: { type: 'string', enum: ACCOUNT_TYPES },
      opening_balance: { type: 'number', description: 'Money in it before tracking started (negative for card dues). Default 0' },
      make_default: { type: 'boolean', description: 'Use it for new entries by default' },
    },
    ['name'],
  ),
  fn(
    'update_account',
    'Change an account: rename, type, opening balance, make it the default, archive or restore it.',
    {
      name: { type: 'string', description: 'Current account name' },
      new_name: { type: 'string' },
      type: { type: 'string', enum: ACCOUNT_TYPES },
      opening_balance: { type: 'number' },
      make_default: { type: 'boolean', description: 'true = make this the default account' },
      archived: { type: 'boolean', description: 'true = archive (hide, keep history), false = restore' },
    },
    ['name'],
  ),
  fn(
    'delete_entries',
    'Show the user a Delete button for these entries. Nothing is deleted until they press it.',
    { ids: { type: 'array', items: { type: 'string' }, description: 'Entry ids from find_transactions' } },
    ['ids'],
  ),
  fn(
    'show_chart',
    'Draw a chart in the app straight from the database. Covers money in/out and splits (who owes, paid back, how fast people pay). Call it several times for several charts.',
    {
      title: { type: 'string', description: 'Short title, e.g. "Spending by category · October"' },
      metric: {
        type: 'string',
        enum: CHART_METRICS,
        description:
          'spending = money out, income = money in, income_vs_spending = both side by side, count = number of entries. Splits: owed = what friends still owe, repaid = what they paid back (dated by the day they paid), owed_vs_repaid = paid back vs still owed side by side, days_to_pay = average days between the bill and the repayment, days_waiting = how long unpaid shares have been waiting',
      },
      group_by: { type: 'string', enum: CHART_GROUPS, description: 'person = by friend (split metrics); day/week/month = over time' },
      from: dateParam('Start date'),
      to: dateParam('End date'),
      chart: { type: 'string', enum: CHART_TYPES, description: 'Leave out to pick automatically' },
      category: { type: 'string', description: 'Only this category' },
      search: { type: 'string', description: 'Only entries whose description matches' },
      account: { type: 'string', description: 'Only this account' },
      person: { type: 'string', description: 'Split metrics: only this friend' },
      limit: { type: 'integer', description: 'Bars/slices before the rest are grouped as Others (default 10)' },
    },
    ['title', 'metric', 'group_by'],
  ),
  fn(
    'draw_chart',
    'Draw any other chart from numbers you already got from tool results in this conversation (never invented). Use when show_chart has no matching metric.',
    {
      title: { type: 'string' },
      chart: { type: 'string', enum: CHART_TYPES },
      x_is_time: { type: 'boolean', description: 'Labels are dates/periods in order' },
      series: {
        type: 'array',
        description: '1-4 data series',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Short id, e.g. "spent"' },
            label: { type: 'string', description: 'Legend text' },
            format: { type: 'string', enum: ['money', 'count', 'days', 'percent'] },
          },
          required: ['key', 'label'],
        },
      },
      points: {
        type: 'array',
        description: 'Up to 60 points: { label, values: { <series key>: number } }',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, values: { type: 'object', additionalProperties: { type: 'number' } } },
          required: ['label', 'values'],
        },
      },
    },
    ['title', 'series', 'points'],
  ),
  fn(
    'show_table',
    `Show a table in the app with CSV, Excel, PDF and Word download buttons. Reports: ${REPORTS.map((r) => `${r} (${REPORT_LABELS[r]})`).join(', ')}. splits = every share with bill date, paid on, days to pay / waiting; people = per friend totals, paid, pending, average and slowest days to pay.`,
    reportProps(),
    ['report'],
  ),
  fn(
    'get_report',
    'Read the same reports as show_table without showing them, to answer questions (e.g. how long Ravi takes to pay, which months I saved most).',
    reportProps(),
    ['report'],
  ),
  fn(
    'export_file',
    'Download a report as a file. Use for any export/download/sheet/PDF/CSV/Word request. Starts the download and shows a card to download again.',
    { ...reportProps(), format: { type: 'string', enum: EXPORT_FORMATS, description: 'xlsx = Excel (default), csv, pdf, docx = Word document' } },
    ['report'],
  ),
  fn('get_settings', 'App settings (your name, split reminder days, month-end summary on/off) and notifications: unread count and the latest ones.'),
  fn(
    'update_settings',
    'Change app settings like the Settings window: the name the app greets you with, after how many days to remind about unpaid splits, and the month-end summary.',
    {
      name: { type: 'string', description: 'Your name, 1-40 characters' },
      reminder_after_days: { type: 'integer', description: 'Remind about an unpaid split after this many days (1-60)' },
      month_end_reminder: { type: 'boolean', description: 'Month-end summary notification on/off' },
    },
  ),
  fn(
    'manage_notifications',
    'Notifications bell: mark_all_read, clear_read (removes read ones; shows a Clear button the user confirms), or check_now (look for new reminders now).',
    { action: { type: 'string', enum: ['mark_all_read', 'clear_read', 'check_now'] } },
    ['action'],
  ),
  fn(
    'delete_account',
    'Delete an account that has no entries (shows a Delete button the user confirms). Accounts with entries can only be archived (update_account archived: true).',
    { name: { type: 'string' } },
    ['name'],
  ),
  fn(
    'remove_budget',
    "Remove a month's budget completely, like Reset on the Budget page (shows a Remove button the user confirms). Earlier months' budget then applies, if any.",
    { month: { type: 'string', description: 'YYYY-MM (default this month)' } },
  ),
  fn(
    'remind_friend',
    'Prepare a WhatsApp reminder for a friend who owes split money, like the WhatsApp button on Collect. Shows a card with Send on WhatsApp and Copy.',
    { person: { type: 'string' } },
    ['person'],
  ),
  fn(
    'app_control',
    'Do things in the app screen: switch dark/light mode, hide/show amounts, lock the app, open a page, open the add-entry form (optionally prefilled), the calculator, Settings, or app lock / PIN setup. The AI can never see or change the PIN itself.',
    {
      command: {
        type: 'string',
        enum: ['dark_mode', 'light_mode', 'hide_amounts', 'show_amounts', 'lock_app', 'open_page', 'open_add_form', 'open_calculator', 'open_settings', 'open_lock_setup'],
      },
      page: { type: 'string', enum: APP_PAGES, description: 'open_page only' },
      prefill: {
        type: 'object',
        description: 'open_add_form only: fields to fill in',
        properties: {
          type: { type: 'string', enum: ['debit', 'credit'] },
          amount: { type: 'number' },
          description: { type: 'string' },
          category: { type: 'string' },
          date: dateParam('Date'),
        },
      },
    },
    ['command'],
  ),
];

function reportProps() {
  return {
    report: { type: 'string', enum: REPORTS },
    from: dateParam('Start date'),
    to: dateParam('End date'),
    type: { type: 'string', enum: ['debit', 'credit', 'transfer'], description: 'transactions only' },
    category: { type: 'string' },
    search: { type: 'string', description: 'Text in the description' },
    account: { type: 'string', description: 'Account name' },
    person: { type: 'string', description: 'splits/people: one friend' },
    status: { type: 'string', enum: ['pending', 'paid', 'all'], description: 'splits: pending or paid back' },
    month: { type: 'string', description: 'budget: YYYY-MM (default this month)' },
    sort: { type: 'string', enum: ['-date', 'date', '-amount', 'amount'], description: 'transactions order' },
  };
}

const accountByName = async (name) => {
  const found = await Account.findOne({ name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') }, { _id: 1, name: 1 }).lean();
  if (found) return found;
  const names = (await Account.find({ archived: { $ne: true } }, { name: 1 }).lean()).map((a) => a.name);
  throw new ToolError(`No account called "${name}". Accounts: ${names.join(', ') || 'none yet'}`);
};

class ToolError extends Error {}

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const splitText = (participants = []) =>
  participants.length ? participants.map((p) => `${p.name} ${rupees(p.amount)}${p.isPaid ? ' (paid)' : ''}`).join(', ') : undefined;
const SIGN = { credit: '+', debit: '-', transfer: '' };

const entryCard = (t, names) => ({
  id: String(t._id),
  date: day(t.date),
  type: t.type,
  amount: t.amount,
  category: t.category,
  description: t.description || undefined,
  account: names.get(String(t.account)),
  toAccount: t.toAccount ? names.get(String(t.toAccount)) : undefined,
  splitWith: splitText(t.participants),
});
const accountCard = (a) => ({
  id: String(a._id),
  name: a.name,
  type: a.type,
  openingBalance: a.openingBalance ?? 0,
  isDefault: Boolean(a.isDefault),
  archived: Boolean(a.archived),
});
const memoLine = (t) =>
  `id=${t.id} ${SIGN[t.type]}₹${t.amount} ${t.type === 'transfer' ? `${t.account}→${t.toAccount}` : t.category}${t.description ? ` "${t.description}"` : ''} ${t.date}${
    t.splitWith ? ` split: ${t.splitWith}` : ''
  }`;

const METHOD_NAMES = { upi: 'UPI', cash: 'Cash', card: 'Card', bank: 'Bank', other: 'Other' };
const countEntries = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
const whenText = (date) => {
  const today = todayISO();
  if (date === today) return 'today';
  if (date === day(new Date(Date.parse(`${today}T00:00:00Z`) - 864e5))) return 'yesterday';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const entryText = (t) =>
  t.type === 'transfer'
    ? `**${rupees(t.amount)}** moved ${t.account} → ${t.toAccount}${t.description ? ` (${t.description})` : ''} · ${whenText(t.date)}`
    : `**${t.type === 'credit' ? '+' : ''}${rupees(t.amount)}** ${t.description || t.category}${t.description ? ` (${t.category})` : ''} · ${whenText(t.date)}${
        t.splitWith ? `, split with ${t.splitWith}` : ''
      }`;
const monthName = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Matches a category name to an existing one (any case), else keeps the new name. */
function resolveCategory(name, type, options) {
  const wanted = name.trim();
  return options[type].find((c) => c.toLowerCase() === wanted.toLowerCase()) ?? wanted.slice(0, 40);
}

const refreshBudgetAlerts = () => checkBudgetAlerts().catch((err) => console.error('Budget alert check failed:', err.message));

const splitList = z.array(z.object({ name: z.string().trim().min(1).max(60), amount: z.coerce.number().positive() })).max(50);

const entryInput = z.object({
  type: z.enum(['debit', 'credit', 'transfer']),
  amount: z.coerce.number().positive().max(1e10),
  description: z.string().trim().max(200).optional(),
  category: z.string().trim().max(40).optional(),
  date: isoDate.optional(),
  account: z.string().trim().max(40).optional(),
  to_account: z.string().trim().max(40).optional(),
  payment_method: z.enum(PAYMENT_METHODS).optional(),
  split_with: splitList.optional(),
  not_split_repayment: z.boolean().optional(),
});

/** People with unpaid split shares whose name appears in the text, e.g. "Got 300 from Ravi". */
async function pendingPeopleIn(texts) {
  const people = (await listPeople()).filter((p) => p.pending > 0);
  return people.filter((p) => {
    const rx = new RegExp(`(^|[^\\p{L}])${escapeRegex(p.name)}($|[^\\p{L}])`, 'iu');
    return texts.some((t) => rx.test(t));
  });
}

/** A person's unpaid (or paid) split shares, oldest first. Falls back to a partial name match. */
async function sharesOf(person, status) {
  let items = (await listSplits({ status, person })).items;
  if (!items.length) {
    const wanted = person.toLowerCase();
    const all = (await listSplits({ status })).items.filter((s) => s.name.toLowerCase().split(/\s+/).includes(wanted) || s.name.toLowerCase().startsWith(wanted));
    const names = [...new Set(all.map((s) => s.name.toLowerCase()))];
    if (names.length > 1) throw new ToolError(`"${person}" could be ${[...new Set(all.map((s) => s.name))].join(' or ')}. Ask which one.`);
    items = all;
  }
  return items.sort((a, b) => a.date - b.date || String(a.participantId).localeCompare(String(b.participantId)));
}

const shareLine = (s) => `${rupees(s.amount)} for ${s.description || s.category} (${whenText(day(s.date))})`;
const shareInfo = (s) => ({ entry_id: String(s.transactionId), for: s.description || s.category, date: day(s.date), amount: s.amount });

/** Which shares a repayment covers: by entry, everything, a single share or the oldest shares adding up to the amount. */
function pickShares(shares, { entry_id, amount, all }) {
  const near = (a, b) => Math.abs(a - b) < 0.005;
  if (entry_id) return shares.filter((s) => String(s.transactionId) === entry_id);
  if (all) return shares;
  if (amount === undefined) return shares.length === 1 ? shares : null;
  const single = shares.find((s) => near(s.amount, amount));
  if (single) return [single];
  let sum = 0;
  for (let i = 0; i < shares.length; i++) {
    sum += shares[i].amount;
    if (near(sum, amount)) return shares.slice(0, i + 1);
  }
  return null;
}

const shareCard = (s, extra = {}) => ({
  transactionId: String(s.transactionId),
  participantId: String(s.participantId),
  name: s.name,
  amount: s.amount,
  for: s.description || s.category,
  billDate: day(s.date),
  ...extra,
});

const actionRunners = {
  async add_entries(args, ctx) {
    const { entries } = z.object({ entries: z.array(entryInput).min(1).max(MAX_NEW_ENTRIES) }).parse(args);
    const isTransfer = (e) => e.type === 'transfer';
    const unclear = entries.map((e, i) => (!isTransfer(e) && !e.description && !e.category ? i + 1 : null)).filter(Boolean);
    if (unclear.length) return { error: `Entry ${unclear.join(', ')} needs what it was for. Ask the user.` };
    const noTarget = entries.map((e, i) => (isTransfer(e) && !e.to_account ? i + 1 : null)).filter(Boolean);
    if (noTarget.length) return { error: `Transfer ${noTarget.join(', ')} needs the account the money goes to. Ask the user.` };

    // Money from someone who owes a split is almost always them paying it back.
    const incoming = entries.filter((e) => e.type === 'credit' && !e.not_split_repayment).map((e) => e.description ?? '');
    const owing = incoming.length ? await pendingPeopleIn(incoming) : [];
    if (owing.length) {
      return {
        error: `${owing.map((p) => `${p.name} still owes ${rupees(p.pending)} from splits`).join('; ')}. If this money is them paying back, call collect_split instead (it marks the split paid and books the repayment). Only if the user says it is unrelated income, call add_entries again with not_split_repayment: true.`,
      };
    }

    const options = await categoryOptions();
    const accounts = new Map();
    for (const name of entries.flatMap((e) => [e.account, e.to_account]).filter(Boolean)) {
      if (!accounts.has(name)) accounts.set(name, await accountByName(name));
    }
    const accountId = (name) => (name ? String(accounts.get(name)._id) : undefined);
    const defaultAccount = entries.some((e) => isTransfer(e) && !e.account) ? await getDefaultAccountId() : null;

    // Unnamed categories come from past choices for the same payee, then keywords.
    const guesses = entries.map((e) => ({ type: e.type, description: e.description ?? '', learnKey: e.description ? merchantKey(e.description) : null }));
    await categorizeRows(guesses.filter((g, i) => !entries[i].category && !isTransfer(entries[i])));

    const prepared = entries.map((e, i) => {
      const from = isTransfer(e) ? (accountId(e.account) ?? (defaultAccount ? String(defaultAccount) : undefined)) : accountId(e.account);
      if (isTransfer(e) && !from) throw new ToolError('Which account did the money leave? Ask the user.');
      return createTransactionSchema.parse({
        type: e.type,
        amount: e.amount,
        category: isTransfer(e) ? TRANSFER_CATEGORY : e.category ? resolveCategory(e.category, e.type, options) : guesses[i].category,
        description: e.description,
        date: e.date ?? todayISO(),
        paymentMethod: e.payment_method,
        account: from,
        toAccount: isTransfer(e) ? accountId(e.to_account) : undefined,
        participants: e.type === 'debit' ? e.split_with : undefined,
      });
    });
    const created = [];
    for (const data of prepared) created.push(await createTransaction(data));
    await refreshBudgetAlerts();

    const names = await accountNames();
    const items = created.map((t) => entryCard(t, names));
    ctx.actions.push({ type: 'created', items });
    ctx.memo.push(`Added: ${items.map(memoLine).join('; ')}`);
    ctx.said.push(
      items.length === 1 ? `Added ${entryText(items[0])}.` : `Added ${countEntries(items.length)}:\n${items.map((t) => `- ${entryText(t)}`).join('\n')}`,
    );
    return { added: items };
  },

  async update_entry(args, ctx) {
    const input = z
      .object({
        id: entryId,
        type: z.enum(['debit', 'credit', 'transfer']).optional(),
        amount: z.coerce.number().positive().optional(),
        description: z.string().trim().max(200).optional(),
        category: z.string().trim().max(40).optional(),
        date: isoDate.optional(),
        account: z.string().trim().max(40).optional(),
        to_account: z.string().trim().max(40).optional(),
        payment_method: z.enum(PAYMENT_METHODS).optional(),
        split_with: splitList.optional(),
      })
      .parse(args);
    const before = await getTransaction(input.id);
    const options = await categoryOptions();
    const type = input.type ?? before.type;
    const changes = updateTransactionSchema.parse(
      Object.fromEntries(
        Object.entries({
          type: input.type,
          amount: input.amount,
          description: input.description,
          category: input.category && type !== 'transfer' ? resolveCategory(input.category, type, options) : undefined,
          date: input.date,
          paymentMethod: input.payment_method,
          account: input.account ? String((await accountByName(input.account))._id) : undefined,
          toAccount: input.to_account ? String((await accountByName(input.to_account))._id) : undefined,
          participants: input.split_with,
        }).filter(([, v]) => v !== undefined),
      ),
    );
    const after = await updateTransaction(input.id, changes);
    await refreshBudgetAlerts();

    const names = await accountNames();
    const [was, now] = [entryCard(before, names), entryCard(after.toObject(), names)];
    const undoValue = (k) => {
      if (k === 'date') return day(before.date);
      if (k === 'account' || k === 'toAccount') return before[k] ? String(before[k]) : null;
      if (k === 'participants') return (before.participants ?? []).filter((p) => !p.isPaid).map(({ name, amount }) => ({ name, amount }));
      return before[k] ?? null;
    };
    const undo = Object.fromEntries(Object.keys(changes).map((k) => [k, undoValue(k)]));
    if (changes.type && changes.type !== before.type) {
      if (before.type === 'transfer') undo.toAccount = String(before.toAccount);
      else undo.category = before.category;
    }
    ctx.actions.push({ type: 'updated', before: was, after: now, undo });
    ctx.memo.push(`Changed: ${memoLine(now)} (was ${memoLine(was)})`);
    const show = {
      amount: rupees,
      date: whenText,
      type: (v) => ({ credit: 'income', debit: 'expense', transfer: 'transfer' })[v],
      splitWith: (v) => (v === '—' ? 'no split' : `split ${v}`),
    };
    const diffs = ['amount', 'description', 'category', 'date', 'account', 'toAccount', 'type', 'splitWith']
      .filter((k) => was[k] !== now[k])
      .map((k) => `${(show[k] ?? String)(was[k] ?? '—')} → ${(show[k] ?? String)(now[k] ?? '—')}`);
    if (changes.paymentMethod && changes.paymentMethod !== before.paymentMethod) diffs.push(`paid by ${METHOD_NAMES[changes.paymentMethod]}`);
    ctx.said.push(`Updated **${now.description || now.category}**${diffs.length ? `: ${diffs.join(', ')}` : ''}.`);
    return { updated: now, previously: was };
  },

  async delete_entries(args, ctx) {
    const { ids } = z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i, 'Not an entry id')).min(1).max(50) }).parse(args);
    const found = await Transaction.find({ _id: { $in: ids } }).lean();
    if (!found.length) return { error: 'None of those ids exist. Search again with find_transactions.' };
    const names = await accountNames();
    const items = found.map((t) => entryCard(t, names));
    ctx.actions.push({ type: 'confirm_delete', items });
    ctx.memo.push(`Asked to confirm deleting: ${items.map(memoLine).join('; ')}`);
    ctx.said.push(`Press **Delete** below to remove ${items.length === 1 ? 'this entry' : `these ${countEntries(items.length)}`}. Nothing is deleted until you do.`);
    return { waitingForUser: true, note: 'The app shows a Delete button. Tell the user to press it to confirm; nothing is deleted yet.', items };
  },

  async collect_split(args, ctx) {
    const q = z
      .object({
        person: z.string().trim().min(1).max(60),
        amount: z.coerce.number().positive().optional(),
        entry_id: entryId.optional(),
        all: z.boolean().optional(),
        date: isoDate.optional(),
        account: z.string().trim().max(40).optional(),
        payment_method: z.enum(PAYMENT_METHODS).optional(),
      })
      .parse(args);
    const shares = await sharesOf(q.person, 'pending');
    if (!shares.length) {
      const owing = (await listPeople()).filter((p) => p.pending > 0);
      return {
        error: `${q.person} has no unpaid split shares. People who owe: ${owing.map((p) => `${p.name} ${rupees(p.pending)}`).join(', ') || 'nobody'}. Ask the user whether this is someone else, or separate income.`,
      };
    }
    const picked = pickShares(shares, q);
    if (!picked?.length) {
      const total = round2(shares.reduce((s, x) => s + x.amount, 0));
      return {
        error: `${q.amount !== undefined ? `${rupees(q.amount)} doesn't match` : 'Not sure which of'} ${shares[0].name}'s unpaid shares (total ${rupees(total)}): ${shares.map(shareLine).join('; ')}. Shares are marked paid whole. Ask the user which one(s) this covers, or whether it's everything.`,
        unpaidShares: shares.map(shareInfo),
      };
    }

    const account = q.account ? String((await accountByName(q.account))._id) : undefined;
    const done = [];
    for (const s of picked) {
      const { settlement } = await markPaid(String(s.transactionId), String(s.participantId), {
        date: q.date ? new Date(`${q.date}T00:00:00Z`) : undefined,
        paymentMethod: q.payment_method,
        account,
      });
      await resolveOverdue(s.participantId);
      done.push(shareCard(s, { paidAt: day(settlement.date), settlementId: String(settlement._id) }));
    }

    const name = picked[0].name;
    const total = round2(picked.reduce((sum, s) => sum + s.amount, 0));
    const left = round2(shares.reduce((sum, s) => sum + s.amount, 0) - total);
    ctx.actions.push({ type: 'split', mode: 'collected', items: done });
    ctx.memo.push(`Marked paid back: ${done.map((s) => `${s.name} ₹${s.amount} for ${s.for} (entry id=${s.transactionId})`).join('; ')}`);
    const what = picked.length === 1 ? `${rupees(total)} for ${picked[0].description || picked[0].category}` : `${picked.length} shares (${rupees(total)})`;
    ctx.said.push(
      `Marked **${name}**'s ${what} as paid back and added **+${rupees(total)}** as Split Repayment. ${left > 0 ? `${name} still owes ${rupees(left)}.` : `${name} is all settled up.`}`,
    );
    return { collected: done, stillOwes: left };
  },

  async reopen_split(args, ctx) {
    const q = z
      .object({ person: z.string().trim().min(1).max(60), entry_id: entryId.optional(), amount: z.coerce.number().positive().optional() })
      .parse(args);
    const shares = (await sharesOf(q.person, 'paid')).reverse();
    if (!shares.length) return { error: `${q.person} has no shares marked as paid.` };
    const picked = q.entry_id
      ? shares.filter((s) => String(s.transactionId) === q.entry_id)
      : q.amount !== undefined
        ? shares.filter((s) => Math.abs(s.amount - q.amount) < 0.005).slice(0, 1)
        : shares.length === 1
          ? shares
          : [];
    if (!picked.length) {
      return {
        error: `Which of ${shares[0].name}'s paid shares? ${shares.slice(0, 10).map(shareLine).join('; ')}. Ask the user.`,
        paidShares: shares.slice(0, 10).map(shareInfo),
      };
    }
    const done = [];
    for (const s of picked) {
      await markUnpaid(String(s.transactionId), String(s.participantId));
      done.push(shareCard(s, { paidAt: day(s.paidAt) }));
    }
    ctx.actions.push({ type: 'split', mode: 'reopened', items: done });
    ctx.memo.push(`Marked not paid: ${done.map((s) => `${s.name} ₹${s.amount} for ${s.for} (entry id=${s.transactionId})`).join('; ')}`);
    ctx.said.push(`Marked **${done[0].name}**'s ${rupees(done[0].amount)} for ${done[0].for} as not paid and removed its repayment entry.`);
    return { reopened: done };
  },

  async set_budget(args, ctx) {
    const limitNum = z.coerce.number().min(0).max(1e10);
    const q = z
      .object({
        month: monthStr.optional(),
        total: limitNum.optional(),
        categories: z.array(z.object({ category: z.string().trim().min(1).max(40), limit: limitNum })).max(50).optional(),
        remove_categories: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
      })
      .parse(args);
    if (q.total === undefined && !q.categories?.length && !q.remove_categories?.length) {
      return { error: 'Nothing to change. Ask the user for the total or category limits.' };
    }
    const month = q.month ?? currentMonth();
    const [own, effective, options] = await Promise.all([Budget.findOne({ month }).lean(), findEffectiveBudget(month), categoryOptions()]);
    const before = effective ? { total: effective.total, categories: effective.categories.map(({ category, limit }) => ({ category, limit })) } : null;
    if (!before && q.total === undefined) {
      return { error: 'There is no budget yet, so it needs a total monthly limit too. Ask the user for it (budget_status has a suggestion).' };
    }

    const limits = new Map((before?.categories ?? []).map((c) => [c.category.toLowerCase(), c]));
    for (const name of q.remove_categories ?? []) limits.delete(name.toLowerCase());
    for (const { category, limit } of q.categories ?? []) {
      const resolved = resolveCategory(category, 'debit', options);
      limits.set(resolved.toLowerCase(), { category: resolved, limit });
    }
    const categories = [...limits.values()];
    const total = q.total ?? (before?.total || round2(categories.reduce((s, c) => s + c.limit, 0)));
    const body = budgetBodySchema.parse({ total, categories });
    await saveBudget(month, body);
    if (month === currentMonth()) await refreshBudgetAlerts();

    const undo = own ? { total: own.total, categories: own.categories.map(({ category, limit }) => ({ category, limit })) } : null;
    ctx.actions.push({ type: 'budget', month, monthLabel: monthName(month), before, after: body, undo });
    ctx.memo.push(`Budget ${month} set: total ₹${body.total}; ${body.categories.map((c) => `${c.category} ₹${c.limit}`).join(', ') || 'no category limits'}`);

    const oldLimits = new Map((before?.categories ?? []).map((c) => [c.category.toLowerCase(), c.limit]));
    const changes = [];
    if (!before || before.total !== body.total) changes.push(`total **${rupees(body.total)}**${before ? ` (was ${rupees(before.total)})` : ''}`);
    for (const c of body.categories) {
      const old = oldLimits.get(c.category.toLowerCase());
      if (old !== c.limit) changes.push(`${c.category} ${rupees(c.limit)}${old !== undefined ? ` (was ${rupees(old)})` : ''}`);
    }
    for (const c of before?.categories ?? []) if (!limits.has(c.category.toLowerCase())) changes.push(`removed the ${c.category} limit`);
    ctx.said.push(`Budget for ${monthName(month)}: ${changes.join(', ') || 'no changes'}.`);
    return { saved: true, month, budget: body };
  },

  async add_account(args, ctx) {
    const q = z
      .object({
        name: z.string().trim().min(1).max(40),
        type: z.enum(ACCOUNT_TYPES).optional(),
        opening_balance: z.coerce.number().optional(),
        make_default: z.boolean().optional(),
      })
      .parse(args);
    const used = new Set((await Account.find({}, { color: 1 }).lean()).map((a) => a.color));
    const data = createAccountSchema.parse({
      name: q.name,
      type: q.type,
      openingBalance: q.opening_balance,
      isDefault: q.make_default,
      color: ACCOUNT_COLORS.find((c) => !used.has(c)) ?? ACCOUNT_COLORS[used.size % ACCOUNT_COLORS.length],
    });
    const account = await createAccount(data);
    const card = accountCard(account);
    ctx.actions.push({ type: 'account', mode: 'created', after: card });
    ctx.memo.push(`Created account id=${card.id} "${card.name}"`);
    ctx.said.push(`Added the **${card.name}** account (${card.type}${card.openingBalance ? `, opening balance ${rupees(card.openingBalance)}` : ''})${card.isDefault ? ', now your default' : ''}.`);
    return { created: card };
  },

  async update_account(args, ctx) {
    const q = z
      .object({
        name: z.string().trim().min(1).max(40),
        new_name: z.string().trim().min(1).max(40).optional(),
        type: z.enum(ACCOUNT_TYPES).optional(),
        opening_balance: z.coerce.number().optional(),
        make_default: z.literal(true).optional(),
        archived: z.boolean().optional(),
      })
      .parse(args);
    const found = await accountByName(q.name);
    const before = await Account.findById(found._id).lean();
    const previousDefault = q.make_default && !before.isDefault ? await Account.findOne({ isDefault: true }, { _id: 1 }).lean() : null;
    const changes = updateAccountSchema.parse(
      Object.fromEntries(
        Object.entries({ name: q.new_name, type: q.type, openingBalance: q.opening_balance, isDefault: q.make_default, archived: q.archived }).filter(
          ([, v]) => v !== undefined,
        ),
      ),
    );
    const after = await updateAccount(String(found._id), changes);

    const undo = [
      {
        id: String(before._id),
        patch: {
          ...Object.fromEntries(Object.keys(changes).filter((k) => k !== 'isDefault').map((k) => [k, before[k]])),
          ...(before.isDefault && changes.archived ? { isDefault: true } : {}),
        },
      },
    ];
    if (previousDefault) undo.push({ id: String(previousDefault._id), patch: { isDefault: true } });
    const [was, now] = [accountCard(before), accountCard(after)];
    ctx.actions.push({ type: 'account', mode: 'updated', before: was, after: now, undo: undo.filter((u) => Object.keys(u.patch).length) });
    ctx.memo.push(`Updated account id=${now.id} "${now.name}"`);
    const diffs = [];
    if (was.name !== now.name) diffs.push(`renamed to **${now.name}**`);
    if (was.type !== now.type) diffs.push(`type ${now.type}`);
    if (was.openingBalance !== now.openingBalance) diffs.push(`opening balance ${rupees(now.openingBalance)} (was ${rupees(was.openingBalance)})`);
    if (!was.isDefault && now.isDefault) diffs.push('now your default account');
    if (was.archived !== now.archived) diffs.push(now.archived ? 'archived' : 'restored');
    ctx.said.push(`Updated **${was.name}**: ${diffs.join(', ') || 'no changes'}.`);
    return { updated: now };
  },

  async show_chart(args, ctx) {
    const q = z
      .object({
        ...range,
        title: z.string().trim().min(1).max(80),
        metric: z.enum(CHART_METRICS),
        group_by: z.enum(CHART_GROUPS),
        chart: z.enum(CHART_TYPES).optional(),
        category: z.string().max(40).optional(),
        search: z.string().max(100).optional(),
        account: z.string().max(40).optional(),
        person: z.string().trim().max(60).optional(),
        limit: z.coerce.number().int().min(3).max(25).default(10),
      })
      .parse(args);
    const account = q.account ? String((await accountByName(q.account))._id) : undefined;
    const chart = await buildChart({ ...q, groupBy: q.group_by, account });
    if (!chart.data.length) return { empty: true, note: 'Nothing matches, so there is nothing to chart. Tell the user.' };
    ctx.actions.push({ type: 'chart', ...chart });
    ctx.memo.push(`Showed chart "${chart.title}"`);
    return { shown: true, chart: chart.chart, total: chart.total, points: chart.data.slice(0, 40) };
  },

  async draw_chart(args, ctx) {
    const q = z
      .object({
        title: z.string().trim().min(1).max(80),
        chart: z.enum(CHART_TYPES).optional(),
        x_is_time: z.boolean().optional(),
        series: z
          .array(
            z.object({
              key: z.string().trim().min(1).max(30),
              label: z.string().trim().min(1).max(40),
              format: z.enum(['money', 'count', 'days', 'percent']).default('money'),
            }),
          )
          .min(1)
          .max(4),
        points: z
          .array(z.object({ label: z.coerce.string().trim().min(1).max(60), values: z.record(z.string(), z.coerce.number().finite()) }))
          .min(1)
          .max(60),
      })
      .parse(args);
    const series = q.series.map((s) => ({ key: s.key, label: s.label, ...(s.format !== 'money' ? { format: s.format } : {}) }));
    const data = q.points.map((p) => ({ label: p.label, ...Object.fromEntries(series.map((s) => [s.key, round2(p.values[s.key] ?? 0)])) }));
    const isAverage = (s) => s.format === 'days' || s.format === 'percent';
    const total = Object.fromEntries(
      series.map((s) => {
        const sum = data.reduce((n, d) => n + d[s.key], 0);
        return [s.key, round2(isAverage(s) ? sum / data.length : sum)];
      }),
    );
    const chart = {
      chart: q.chart ?? (q.x_is_time ? 'area' : series.length === 1 && data.length <= 8 && !isAverage(series[0]) ? 'donut' : 'bar'),
      title: q.title,
      series: series.map((s) => (isAverage(s) ? { ...s, aggregate: 'avg' } : s)),
      data,
      total,
      groupBy: q.x_is_time ? 'day' : 'custom',
    };
    ctx.actions.push({ type: 'chart', ...chart });
    ctx.memo.push(`Drew chart "${chart.title}"`);
    return { shown: true };
  },

  async show_table(args, ctx) {
    const { report, filters } = await reportRequest(args);
    const table = await buildReport(report, filters, { limit: 200 });
    if (!table.rows.length) return { empty: true, note: 'Nothing matches these filters. Tell the user.' };
    ctx.actions.push({ type: 'table', ...table, params: filters });
    ctx.memo.push(`Showed table "${table.title}" (${table.count} rows)`);
    ctx.said.push(`Here's **${table.title}** · ${table.subtitle} (${table.count} ${table.count === 1 ? 'row' : 'rows'}). Download it as CSV, Excel, PDF or Word from the card.`);
    return { shown: true, count: table.count, columns: table.columns.map((c) => c.label), rows: table.rows.slice(0, 30) };
  },

  async export_file(args, ctx) {
    const { report, filters } = await reportRequest(args);
    const format = z.enum(EXPORT_FORMATS).default('xlsx').parse(args.format);
    const { count, title, subtitle } = await buildReport(report, filters, { limit: 1 });
    if (!count) return { count: 0, note: 'Nothing matches these filters, so there is nothing to export. Tell the user.' };
    ctx.actions.push({ type: 'export', report, format, params: filters, count, title, subtitle });
    ctx.memo.push(`Prepared ${format} export of "${title}" (${count} rows)`);
    ctx.said.push(`Your ${FORMAT_NAMES[format]} of **${title}** · ${subtitle} (${count} ${count === 1 ? 'row' : 'rows'}) is downloading.`);
    return { ready: true, count, note: 'The app starts the download and shows a button to download again.' };
  },

  async update_settings(args, ctx) {
    const q = z
      .object({ name: z.string().optional(), reminder_after_days: z.coerce.number().optional(), month_end_reminder: z.boolean().optional() })
      .parse(args);
    const patch = settingsBodySchema.parse(
      Object.fromEntries(
        Object.entries({ name: q.name, reminderAfterDays: q.reminder_after_days, monthEndReminder: q.month_end_reminder }).filter(([, v]) => v !== undefined),
      ),
    );
    const current = await getSettings();
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k]]));
    await updateSettings(patch);
    ctx.actions.push({ type: 'settings', before, after: patch, undo: before });
    ctx.memo.push(`Settings changed: ${JSON.stringify(patch)}`);
    const parts = [];
    if ('name' in patch) parts.push(`I'll call you **${patch.name}**`);
    if ('reminderAfterDays' in patch) parts.push(`split reminders after **${patch.reminderAfterDays} ${patch.reminderAfterDays === 1 ? 'day' : 'days'}**`);
    if ('monthEndReminder' in patch) parts.push(`month-end summary **${patch.monthEndReminder ? 'on' : 'off'}**`);
    ctx.said.push(`Done: ${parts.join(', ')}.`);
    return { saved: patch };
  },

  async manage_notifications(args, ctx) {
    const { action } = z.object({ action: z.enum(['mark_all_read', 'clear_read', 'check_now']) }).parse(args);
    if (action === 'mark_all_read') {
      const count = await Notification.countDocuments({ read: false });
      await markAllRead();
      ctx.actions.push({ type: 'notifications', mode: 'read', count });
      ctx.said.push(count ? `Marked **${count}** ${count === 1 ? 'notification' : 'notifications'} as read.` : 'There were no unread notifications.');
      return { markedRead: count };
    }
    if (action === 'clear_read') {
      const count = await Notification.countDocuments({ read: true });
      if (!count) {
        ctx.said.push('There are no read notifications to clear.');
        return { count: 0 };
      }
      ctx.actions.push({ type: 'confirm', kind: 'clear_notifications', title: `Clear ${count} read ${count === 1 ? 'notification' : 'notifications'}?`, confirmLabel: 'Clear' });
      ctx.said.push(`Press **Clear** to remove ${count} read ${count === 1 ? 'notification' : 'notifications'}.`);
      return { needsConfirmation: true, count };
    }
    const before = await Notification.countDocuments({});
    await runAllChecks();
    const { items, unreadCount } = await listNotifications({ limit: 5, unread: true });
    const added = Math.max(0, (await Notification.countDocuments({})) - before);
    ctx.actions.push({ type: 'notifications', mode: 'checked', added, unread: unreadCount });
    ctx.said.push(
      added
        ? `Found **${added}** new ${added === 1 ? 'reminder' : 'reminders'}: ${items.slice(0, added).map((n) => n.title).join('; ')}.`
        : `No new reminders. ${unreadCount ? `You have ${unreadCount} unread.` : "You're all caught up."}`,
    );
    return { added, unread: unreadCount };
  },

  async delete_account(args, ctx) {
    const { name } = z.object({ name: z.string().trim().min(1).max(40) }).parse(args);
    const found = await accountByName(name);
    const used = await Transaction.countDocuments({ $or: [{ account: found._id }, { toAccount: found._id }] });
    if (used) {
      return { error: `${found.name} has ${countEntries(used)}, so it can't be deleted. Offer to archive it instead (update_account archived: true), which hides it and keeps the history.` };
    }
    ctx.actions.push({ type: 'confirm', kind: 'delete_account', id: String(found._id), name: found.name, title: `Delete the ${found.name} account?`, confirmLabel: 'Delete' });
    ctx.said.push(`**${found.name}** has no entries. Press **Delete** to remove it.`);
    return { needsConfirmation: true };
  },

  async remove_budget(args, ctx) {
    const month = monthStr.optional().parse(args.month) ?? currentMonth();
    const own = await Budget.findOne({ month }).lean();
    if (!own) {
      const effective = await findEffectiveBudget(month);
      return {
        error: effective
          ? `${monthName(month)} has no budget of its own; it uses the one set in ${monthName(effective.month)}. Ask whether to remove that month's budget instead.`
          : `There is no budget for ${monthName(month)}. Tell the user.`,
      };
    }
    const before = { total: own.total, categories: own.categories.map(({ category, limit }) => ({ category, limit })) };
    ctx.actions.push({ type: 'confirm', kind: 'remove_budget', month, monthLabel: monthName(month), before, title: `Remove the ${monthName(month)} budget?`, confirmLabel: 'Remove' });
    ctx.said.push(`The ${monthName(month)} budget is **${rupees(own.total)}**${before.categories.length ? ` with ${before.categories.length} category ${before.categories.length === 1 ? 'limit' : 'limits'}` : ''}. Press **Remove** to delete it.`);
    return { needsConfirmation: true };
  },

  async remind_friend(args, ctx) {
    const { person } = z.object({ person: z.string().trim().min(1).max(60) }).parse(args);
    const shares = await sharesOf(person, 'pending');
    if (!shares.length) return { error: `${person} doesn't owe anything right now. Tell the user.` };
    const { name: me = 'me' } = await getSettings();
    const exact = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const total = round2(shares.reduce((s, x) => s + x.amount, 0));
    const who = shares[0].name;
    const dated = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const lines = shares.map((s) => `• ${s.description || s.category} (${dated(s.date)}): ${exact(s.amount)}`);
    const text = `Hey ${who}, just a friendly reminder. You owe me ${exact(total)} for:\n${lines.join('\n')}\n\nThanks! – ${me}`;
    ctx.actions.push({ type: 'remind', person: who, amount: total, count: shares.length, text });
    ctx.said.push(`Here's a reminder for **${who}** (${rupees(total)} from ${shares.length} ${shares.length === 1 ? 'split' : 'splits'}). Tap **Send on WhatsApp** or **Copy**.`);
    return { prepared: true, total };
  },

  async app_control(args, ctx) {
    const q = z
      .object({
        command: z.enum(['dark_mode', 'light_mode', 'hide_amounts', 'show_amounts', 'lock_app', 'open_page', 'open_add_form', 'open_calculator', 'open_settings', 'open_lock_setup']),
        page: z.enum(APP_PAGES).optional(),
        prefill: z
          .object({
            type: z.enum(['debit', 'credit']).optional(),
            amount: z.coerce.number().positive().optional(),
            description: z.string().trim().max(200).optional(),
            category: z.string().trim().max(40).optional(),
            date: isoDate.optional(),
          })
          .optional(),
      })
      .parse(args);
    if (q.command === 'open_page' && !q.page) return { error: 'Which page? One of: ' + APP_PAGES.join(', ') };
    ctx.actions.push({ type: 'app', command: q.command, ...(q.page ? { page: q.page } : {}), ...(q.prefill ? { prefill: q.prefill } : {}) });
    const pageName = { home: 'Home', activity: 'Activity', accounts: 'Accounts', collect: 'Collect', budget: 'Budget', import: 'Import' }[q.page];
    ctx.said.push(
      {
        dark_mode: 'Switched to dark mode.',
        light_mode: 'Switched to light mode.',
        hide_amounts: 'Amounts are hidden now. Say "show amounts" or press M to bring them back.',
        show_amounts: 'Amounts are visible again.',
        lock_app: 'Locking DhanFlow now.',
        open_page: `Opening ${pageName}.`,
        open_add_form: 'Opened the add-entry form. Check it and press Save.',
        open_calculator: 'Opened the calculator.',
        open_settings: 'Opened Settings.',
        open_lock_setup: 'Opened app lock setup. Choose your pattern or PIN there; I never see it.',
      }[q.command],
    );
    return { done: true };
  },
};

const FORMAT_NAMES = { xlsx: 'Excel file', csv: 'CSV', pdf: 'PDF', docx: 'Word document' };

const reportInput = z.object({
  report: z.enum(REPORTS),
  ...range,
  type: z.enum(['debit', 'credit', 'transfer']).optional(),
  category: z.string().trim().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  account: z.string().trim().max(40).optional(),
  person: z.string().trim().max(60).optional(),
  status: z.enum(['pending', 'paid', 'all']).optional(),
  month: monthStr.optional(),
  sort: z.enum(['-date', 'date', '-amount', 'amount']).optional(),
});

/** Validates report arguments and turns an account name into its id. */
async function reportRequest(args) {
  const { report, account, format: _format, ...rest } = reportInput.extend({ format: z.any().optional() }).parse(args);
  const found = account ? await accountByName(account) : null;
  return { report, filters: { ...rest, ...(found ? { account: String(found._id) } : {}) } };
}

const runners = {
  async get_settings() {
    const [{ name, reminderAfterDays, monthEndReminder }, { items, unreadCount }] = await Promise.all([getSettings(), listNotifications({ limit: 10 })]);
    return {
      settings: { name, reminderAfterDays, monthEndReminder },
      notifications: { unread: unreadCount, latest: items.map((n) => ({ title: n.title, message: n.message, read: n.read, date: day(n.createdAt) })) },
    };
  },

  async get_report(args) {
    const { report, filters } = await reportRequest(args);
    const table = await buildReport(report, filters, { limit: 100 });
    return { title: table.title, filters: table.subtitle, count: table.count, truncated: table.truncated, columns: table.columns, rows: table.rows };
  },

  async get_overview(args) {
    const { from, to } = z.object(range).parse(args);
    const s = await getSummary({ from, to, months: 1 });
    return {
      period: { from, to, ...s.period },
      byCategory: s.byCategory.slice(0, 15),
      owedToMe: s.pending,
      balanceNow: s.balance,
    };
  },

  async find_transactions(args) {
    const q = z
      .object({
        ...range,
        type: z.enum(['debit', 'credit', 'transfer']).optional(),
        category: z.string().max(40).optional(),
        search: z.string().max(100).optional(),
        account: z.string().max(40).optional(),
        sort: z.enum(['-amount', 'amount', '-date', 'date']).default('-date'),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(args);

    let account;
    if (q.account) {
      const found = await Account.findOne({ name: new RegExp(`^${escapeRegex(q.account)}$`, 'i') }, { _id: 1 }).lean();
      if (!found) {
        const names = (await Account.find({}, { name: 1 }).lean()).map((a) => a.name);
        return { error: `No account called "${q.account}"`, accounts: names };
      }
      account = String(found._id);
    }

    const [result, names] = await Promise.all([listTransactions({ ...q, account, page: 1 }), accountNames()]);
    return {
      matching: result.pagination.total,
      totals: { moneyIn: result.totals.in, moneyOut: result.totals.out },
      shown: result.items.length,
      items: result.items.map((t) => ({
        id: String(t._id),
        date: day(t.date),
        type: t.type,
        amount: t.amount,
        category: t.category,
        description: t.description || undefined,
        account: names.get(String(t.account)),
        toAccount: t.toAccount ? names.get(String(t.toAccount)) : undefined,
        splitWith: t.participants?.length
          ? t.participants.map((p) => ({ name: p.name, amount: p.amount, paidBack: p.isPaid }))
          : undefined,
        isRepayment: t.settlementOf ? true : undefined,
      })),
    };
  },

  async spending_over_time(args) {
    const { from, to, group_by: unit } = z.object({ ...range, group_by: z.enum(['day', 'week', 'month']) }).parse(args);
    const rows = await Transaction.aggregate([
      { $match: { ...dateRangeMatch(from, to), type: { $in: ['credit', 'debit'] } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$date', unit, ...(unit === 'week' ? { startOfWeek: 'monday' } : {}) } },
          income: sumIf(isIncome),
          repayments: sumIf(isRepayment),
          spent: sumIf(isDebit),
          myShare: sumIf(isDebit, myShareExpr),
          entries: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 400 },
    ]);
    return rows.map((r) => ({
      period: day(r._id),
      income: round2(r.income),
      repayments: round2(r.repayments),
      spent: round2(r.spent),
      myShare: round2(r.myShare),
      entries: r.entries,
    }));
  },

  async top_payees(args) {
    const { from, to, type, limit } = z
      .object({ ...range, type: z.enum(['debit', 'credit']).default('debit'), limit: z.coerce.number().int().min(1).max(30).default(10) })
      .parse(args);
    const label = { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$description', ''] } }, 0] }, '$description', '$category'] };
    const rows = await Transaction.aggregate([
      { $match: { ...dateRangeMatch(from, to), type } },
      {
        $group: {
          _id: { $toLower: label },
          name: { $first: label },
          category: { $first: '$category' },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
          lastDate: { $max: '$date' },
        },
      },
      { $sort: { total: -1 } },
      { $limit: limit },
    ]);
    return rows.map((r) => ({ name: r.name, category: r.category, total: round2(r.total), count: r.count, lastDate: day(r.lastDate) }));
  },

  async list_accounts() {
    const { accounts, unassigned, total } = await listAccounts();
    return {
      total,
      accounts: accounts.map((a) => ({
        name: a.name,
        type: a.type,
        balance: a.balance,
        thisMonthIn: a.monthIn,
        thisMonthOut: a.monthOut,
        isDefault: a.isDefault || undefined,
        archived: a.archived || undefined,
      })),
      entriesWithoutAccount: unassigned ?? undefined,
    };
  },

  async money_owed_to_me() {
    const [people, { items }] = await Promise.all([listPeople(), listSplits({ status: 'pending' })]);
    return people
      .filter((p) => p.pending > 0)
      .map((p) => ({
        name: p.name,
        pending: p.pending,
        lastActivity: day(p.lastActivity),
        unpaidShares: items
          .filter((s) => s.name.toLowerCase() === p.name.toLowerCase())
          .slice(0, 15)
          .map(shareInfo),
      }));
  },

  async budget_status(args) {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') }).parse(args);
    const b = await getBudgetStatus(month, { withSuggestion: false });
    return {
      month,
      budgetTotal: b.budget?.total ?? null,
      spent: b.spent,
      remaining: b.remaining,
      percentUsed: b.percent,
      projectedMonthEnd: b.projected,
      safeDailySpend: b.safeDaily,
      daysLeft: b.daysLeft,
      categories: b.categories.map(({ category, limit, spent, remaining, percent }) => ({ category, limit, spent, remaining, percent })),
    };
  },
};

const dropEmpty = (args) =>
  Object.fromEntries(Object.entries(args ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));

async function runTool(name, rawArgs, ctx) {
  const runner = runners[name] ?? actionRunners[name];
  if (!runner) return { error: `Unknown tool ${name}` };
  let args;
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs;
  } catch {
    return { error: 'Arguments were not valid JSON' };
  }
  try {
    return await runner(dropEmpty(args), ctx);
  } catch (err) {
    if (err instanceof ZodError) return { error: 'Invalid arguments', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    if (err instanceof ToolError || (err instanceof ApiError && err.status < 500)) return { error: err.message };
    throw err;
  }
}

const listOrNone = (list) => list.join(', ') || 'none yet';

async function systemPrompt(name) {
  const today = todayISO();
  const month = today.slice(0, 7);
  const lastMonth = shiftMonth(month, -1);
  const lastMonthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
  const [categories, accounts] = await Promise.all([
    categoryOptions(),
    Account.find({ archived: { $ne: true } }, { name: 1, isDefault: 1 }).sort({ isDefault: -1, createdAt: 1 }).lean(),
  ]);
  const accountList = accounts.map((a) => (a.isDefault ? `${a.name} (default)` : a.name));

  return `You are DhanFlow, ${name}'s personal money assistant inside their expense tracker. You can read their data AND do anything ${name} can do in the app: add, edit and delete entries, transfers between accounts, split expenses, record friends paying back and remind them, budgets, accounts, settings, notifications, app controls (theme, hide amounts, lock, pages), charts, tables and exports (Excel, CSV, PDF, Word). Today is ${weekday}, ${today}. Money is in Indian rupees.
Spending categories: ${listOrNone(categories.debit)}. Income categories: ${listOrNone(categories.credit)}. Accounts: ${listOrNone(accountList)}.

Answering questions:
- Get every number from the tools. Never guess or invent figures, dates or names. If the data can't answer the question, say so plainly.
- Work out date ranges yourself: this month = ${month}-01 to ${today}; last month = ${lastMonth}-01 to ${lastMonthEnd}; weeks start on Monday. "All time" means no dates.
- "spent" is the full amount paid; "myShare" is what ${name} really spent after friends repay their split. Prefer myShare for "how much did I spend", and mention splits when they matter.
- Transfers between ${name}'s own accounts are neither spending nor income. Repayments are friends paying back splits, not income.

Adding entries (add_entries):
- An entry needs an amount and what it was for. If either is missing, ask for exactly what's missing in one short question and don't call the tool yet. Don't ask about anything else.
- Date defaults to today; "yesterday", "last Friday", "on 5th" etc. you convert yourself. Account defaults to the default one. Pick the closest listed category, or leave it out when unsure.
- Spent/paid/bought = debit. Got/received/salary/earned = credit. Several items in one message = several entries in one call.
- "Split with Ravi and Anu" on ₹900 means split_with Ravi 300 and Anu 300 (equal shares including ${name}) unless amounts are given.
- Moving money between ${name}'s own accounts (ATM withdrawal to Cash, paying the card bill from the bank, wallet top-up, "moved 5000 from HDFC to savings") is type transfer with account (from) and to_account. It is not spending or income.

Splits:
- When someone pays ${name} back ("Ravi paid me back", "got 300 from Ravi for dinner", "Anu settled up", "Ravi sent his share"), call collect_split, never add_entries. It marks their share paid and books the repayment, just like Mark paid on the Splits page. Pass amount if given; pass all if they paid everything.
- If collect_split says the amount doesn't match or asks which share, show the user the unpaid shares briefly and ask. If the person owes nothing, ask whether it's someone else or separate income.
- "Ravi didn't actually pay" / undo a repayment = reopen_split.
- To split an existing expense, add or remove people, or change shares, use update_entry with split_with: the full new list of unpaid people (check current shares with find_transactions first).

Changing or deleting entries:
- Find the entry with find_transactions (or use an id from an earlier [Added …] note), then update_entry. If several entries could match, list them briefly and ask which one.
- delete_entries only shows a Delete button; the user confirms. Never claim something is deleted.
- Repayment entries can't be edited directly: use reopen_split, then collect_split again if needed.

Budgets and accounts:
- set_budget changes the monthly total and/or category limits (only what the user mentions). Use budget_status to read the current budget first if the user asks for a relative change ("raise food by 1000").
- add_account and update_account (rename, type, opening balance, make default, archive/restore) work like the Accounts page. delete_account only works for accounts with no entries; otherwise offer to archive.
- remove_budget deletes a month's budget completely (the user confirms); to change limits use set_budget.

App, settings and reminders:
- get_settings / update_settings: the name the app uses, split reminder days, month-end summary. manage_notifications: mark all read, clear read ones, check for new reminders now.
- "Remind Ravi" / "send Ravi a reminder" = remind_friend (WhatsApp message card).
- Dark/light mode, hide/show amounts, lock the app, open a page (home, activity, accounts, collect, budget, import), open the add-entry form, calculator, Settings, app lock setup = app_control. To import a statement, tell the user to tap 📎 (or open the import page).
- You can't see or change the PIN/pattern: open_lock_setup lets the user do it.

Charts, tables and exports (never say the app can't show or export something; these tools cover everything):
- For any chart, graph, plot, visual, trend or breakdown request, call show_chart. It covers spending/income AND splits: owed (who owes how much), repaid (paid back, by person or over time), owed_vs_repaid, days_to_pay (how fast each person pays back), days_waiting (how long unpaid shares have waited). A request covering several things ("who owes, when they paid and how long they took") = several show_chart calls in one go, plus show_table report splits for the dates.
- If no show_chart metric fits, get the numbers with other tools first (get_report, get_overview, spending_over_time, top_payees…), then call draw_chart with exactly those numbers.
- The app draws charts, so never describe a chart in text, draw ASCII art or paste the data as text. After charts, add one or two lines on what stands out.
- To show data as a table (lists, reports, "show me all…", "details"), call show_table; it has CSV, Excel, PDF and Word buttons.
- For export/download/Excel/CSV/PDF/Word/doc/sheet requests, call export_file with the report, filters and format (default xlsx; Word/doc/docx = docx). Entries = transactions, splits = each share with paid dates, people = per friend summary, plus accounts, budget, categories, monthly.

Style:
- Keep replies short, warm and practical, like a smart friend. Write amounts like ₹1,25,000 (Indian grouping). Use short bullet lists for breakdowns and **bold** for the key figure.
- After an action, confirm in one line what happened (e.g. "Added **₹500** Petrol for today."). The app shows a card with Undo, so don't repeat every field.
- Lines in [square brackets] at the end of your earlier replies are notes from the app about what was done, with entry ids. Use them, but never write such notes yourself or show ids to the user.
- Reply in the language the user writes in.`;
}

/**
 * Answers a question or carries out a request. `history` is the chat so far (user/assistant turns).
 * Returns `{ reply, toolsUsed, actions, memo }`: actions are cards the app renders (charts, added entries…),
 * memo is a short note of what was done that the app sends back with this turn next time.
 */
export async function askAssistant(history) {
  const { name = 'you' } = await getSettings();
  const messages = [{ role: 'system', content: await systemPrompt(name) }, ...history];
  const toolsUsed = new Set();
  const ctx = { actions: [], memo: [], said: [] };
  const done = (reply) => ({ reply, toolsUsed: [...toolsUsed], actions: ctx.actions, memo: ctx.memo.join('\n') });

  for (let step = 0; step < MAX_STEPS; step++) {
    const message = await chatCompletion({ messages, tools: TOOLS, temperature: 0.2 });
    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      const reply = (message.content ?? '').replace(/(\n\s*\[[^\]\n]*\]\s*)+$/, '').trim();
      if (reply) return done(reply);
      return done(ctx.actions.length ? 'Done.' : "I couldn't find an answer to that. Try asking it another way.");
    }
    // Sent back whole: Gemini rejects the next turn unless its thought signatures come back untouched.
    messages.push({ ...message, role: 'assistant', content: message.content ?? '', tool_calls: calls });
    let allSaid = true;
    for (const call of calls) {
      toolsUsed.add(call.function?.name);
      const before = ctx.said.length;
      const result = await runTool(call.function?.name, call.function?.arguments, ctx);
      allSaid &&= ctx.said.length > before;
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS) });
    }
    // Plain actions confirm themselves; skipping the follow-up AI call halves usage of small free quotas.
    if (allSaid) return done(ctx.said.join('\n\n'));
  }
  return done(ctx.actions.length ? 'Done. See below.' : 'That needed more digging than I can do in one go. Try a narrower question.');
}
