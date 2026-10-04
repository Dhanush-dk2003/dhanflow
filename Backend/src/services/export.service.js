import ExcelJS from 'exceljs';
import { Transaction } from '../models/Transaction.js';
import { round2 } from '../utils/helpers.js';
import { accountNames } from './account.service.js';
import { buildFilter, sortSpec } from './transaction.service.js';

const RUPEES = '"₹"#,##0.00';
const DATE = 'dd-mmm-yyyy';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11121F' } };
const BAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F5FA' } };
const GREEN = { argb: 'FF047857' };
const RED = { argb: 'FFBE123C' };
const TOP_BORDER = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } };

const TYPE_LABELS = { credit: 'Money in', debit: 'Money out', transfer: 'Transfer' };
const METHOD_LABELS = { upi: 'UPI', cash: 'Cash', card: 'Card', bank: 'Bank', other: 'Other' };

const COLUMNS = [
  { header: 'Date', key: 'date', width: 13, style: { numFmt: DATE } },
  { header: 'Type', key: 'type', width: 11 },
  { header: 'Category', key: 'category', width: 18 },
  { header: 'Description', key: 'description', width: 34 },
  { header: 'Account', key: 'account', width: 18 },
  { header: 'To account', key: 'toAccount', width: 18 },
  { header: 'Paid via', key: 'method', width: 10 },
  { header: 'Amount', key: 'amount', width: 14, style: { numFmt: RUPEES } },
  { header: 'Money in', key: 'in', width: 14, style: { numFmt: RUPEES, font: { color: GREEN } } },
  { header: 'Money out', key: 'out', width: 14, style: { numFmt: RUPEES, font: { color: RED } } },
  { header: 'My share', key: 'myShare', width: 14, style: { numFmt: RUPEES } },
  { header: 'Split with', key: 'splitWith', width: 40 },
];
const col = (key) => String.fromCharCode(65 + COLUMNS.findIndex((c) => c.key === key));

const styleHeader = (row) => {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle' };
  });
};

const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function describeFilters(query, names) {
  const { from, to, account, type, category, search, split } = query;
  const day = (d) => fmtDay(new Date(d).toISOString().slice(0, 10));
  const period = from || to ? `${from ? day(from) : 'Start'} – ${to ? day(to) : 'Today'}` : 'All time';
  return [
    ['Period', period],
    ['Account', account === 'none' ? 'Not linked to an account' : account ? (names.get(account) ?? 'Unknown') : 'All accounts'],
    ['Type', type ? TYPE_LABELS[type] : 'All'],
    ['Category', category || 'All'],
    ...(split ? [['Splits', split === 'true' ? 'Only split bills' : 'Without splits']] : []),
    ...(search ? [['Search', search]] : []),
  ];
}

/**
 * Streams an .xlsx with a formatted "Transactions" sheet (same filter and order as the
 * Activity page) and a "Summary" sheet. Rows come from a cursor, so memory stays flat.
 */
export async function streamExcel(query, res) {
  const names = await accountNames();
  const nameOf = (id) => (id ? (names.get(String(id)) ?? '') : '');
  const accountId = query.account && query.account !== 'none' ? query.account : null;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="DhanFlow-transactions-${new Date().toISOString().slice(0, 10)}.xlsx"`);

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
  workbook.creator = 'DhanFlow';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS;
  sheet.autoFilter = { from: 'A1', to: `${col('splitWith')}1` };
  styleHeader(sheet.getRow(1));
  sheet.getRow(1).commit();

  const totals = { in: 0, out: 0, count: 0 };
  const spendByCategory = new Map();

  const cursor = Transaction.find(buildFilter(query)).sort(sortSpec(query.sort)).lean().cursor();
  for await (const t of cursor) {
    const participants = t.participants ?? [];
    const owed = participants.reduce((sum, p) => sum + p.amount, 0);
    // Transfers are internal moves; they only count as in/out when looking at one account.
    let direction = t.type === 'credit' ? 'in' : t.type === 'debit' ? 'out' : null;
    if (t.type === 'transfer' && accountId) direction = String(t.toAccount) === accountId ? 'in' : 'out';

    const row = sheet.addRow({
      date: t.date,
      type: TYPE_LABELS[t.type],
      category: t.category,
      description: t.description || '',
      account: nameOf(t.account),
      toAccount: nameOf(t.toAccount),
      method: t.type === 'transfer' ? '' : (METHOD_LABELS[t.paymentMethod] ?? t.paymentMethod ?? ''),
      amount: t.amount,
      in: direction === 'in' ? t.amount : null,
      out: direction === 'out' ? t.amount : null,
      myShare: t.type === 'debit' ? round2(t.amount - owed) : null,
      splitWith: participants.map((p) => `${p.name} ₹${p.amount} (${p.isPaid ? 'paid' : 'pending'})`).join('; '),
    });
    totals.count += 1;
    if (row.number % 2 === 1) row.eachCell({ includeEmpty: true }, (cell) => (cell.fill = BAND_FILL));
    row.commit();

    if (direction) totals[direction] += t.amount;
    if (t.type === 'debit') spendByCategory.set(t.category, (spendByCategory.get(t.category) ?? 0) + t.amount);
  }

  if (totals.count) {
    const last = totals.count + 1;
    const sum = (key, result) => ({ formula: `SUM(${col(key)}2:${col(key)}${last})`, result: round2(result) });
    const totalRow = sheet.addRow({ description: 'Total', in: sum('in', totals.in), out: sum('out', totals.out) });
    totalRow.eachCell((cell) => {
      cell.font = { ...cell.font, bold: true };
      cell.border = TOP_BORDER;
    });
    totalRow.commit();
  }
  sheet.commit();

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ width: 26 }, { width: 22 }, { width: 12 }];
  const title = summary.addRow(['DhanFlow · transactions export']);
  title.font = { bold: true, size: 14 };
  title.commit();
  summary.addRow([`Exported on ${fmtDay(new Date().toISOString().slice(0, 10))}`]).commit();
  summary.addRow([]).commit();

  for (const [label, value] of describeFilters(query, names)) {
    const r = summary.addRow([label, value]);
    r.getCell(1).font = { color: { argb: 'FF6B7280' } };
    r.commit();
  }
  summary.addRow(['Entries', totals.count]).commit();
  summary.addRow([]).commit();

  const money = (label, value, color) => {
    const r = summary.addRow([label, round2(value)]);
    r.getCell(2).numFmt = RUPEES;
    r.getCell(2).font = { bold: true, ...(color ? { color } : {}) };
    r.commit();
  };
  money('Money in', totals.in, GREEN);
  money('Money out', totals.out, RED);
  money('Net', totals.in - totals.out, totals.in >= totals.out ? GREEN : RED);

  if (spendByCategory.size) {
    summary.addRow([]).commit();
    const head = summary.addRow(['Spending by category', 'Spent', 'Share']);
    styleHeader(head);
    head.commit();
    const spent = [...spendByCategory.values()].reduce((a, b) => a + b, 0);
    for (const [category, amount] of [...spendByCategory].sort((a, b) => b[1] - a[1])) {
      const r = summary.addRow([category, round2(amount), spent ? amount / spent : 0]);
      r.getCell(2).numFmt = RUPEES;
      r.getCell(3).numFmt = '0%';
      r.commit();
    }
  }
  summary.commit();

  await workbook.commit();
}
