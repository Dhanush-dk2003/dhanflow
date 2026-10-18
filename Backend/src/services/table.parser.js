// Reads entries from spreadsheet-like rows (Excel, CSV, Word tables) and from loose text lines
// ("Petrol 500 yesterday"). Only an amount is required; the date falls back to today.

import { describe, findDates, findReference, findTime, textHint, titleCase } from './statement.parser.js';
import { todayISO } from '../utils/dates.js';

const DAY_MS = 86_400_000;
const HEADER_SCAN_ROWS = 30;
const SAMPLE_ROWS = 300;

const norm = (v) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9₹/&]+/g, ' ')
    .trim();

// First match wins, so specific titles ("Withdrawal Amt.", "Closing Balance") come before broad ones.
const HEADERS = [
  ['balance', /\b(balance|bal)\b/],
  ['ref', /\b(ref|reference|utr|rrn|cheque|chq|txn id|transaction id|order id|ref no)\b/],
  ['time', /^(time|txn time|transaction time)$/],
  ['date', /\b(date|dt)\b|^(when|day|on)$/],
  ['type', /^(type|txn type|transaction type|dr ?\/ ?cr|cr ?\/ ?dr|debit ?\/ ?credit|credit ?\/ ?debit|in ?\/ ?out|income ?\/ ?expense|expense ?\/ ?income|kind|nature)$/],
  ['debit', /\b(withdrawals?|debits?|dr|paid out|money out|outflow|spent|spends?|expenses?|expenditure)\b/],
  ['credit', /\b(deposits?|credits?|cr|received|money in|inflow|income|earnings?)\b/],
  ['amount', /\b(amount|amt|price|cost|total|value|rs|inr|rupees|₹|sum)\b/],
  ['category', /\b(category|categories|head|group|tag|bucket|expense type)\b/],
  ['method', /\b(payment mode|payment method|mode|method|paid via|paid by|paid using|via|payment type|instrument)\b/],
  ['account', /^(account|bank|a ?\/ ?c|wallet|card|account name|from account|source|paid from)$/],
  ['status', /^(status|txn status|transaction status)$/],
  ['place', /^(where|place|shop|store|location|vendor|merchant|at|outlet)$/],
  ['description', /\b(description|particulars|narration|details|remarks?|notes?|items?|name|payee|paid to|to ?\/ ?from|purpose|what|title|reason|for|memo|comments?|transaction|beneficiary|party)\b/],
];
const MONEY_KEYS = ['amount', 'debit', 'credit'];
const LABELS = {
  date: 'date',
  amount: 'amount',
  debit: 'money out',
  credit: 'money in',
  description: 'description',
  place: 'place',
  category: 'category',
  type: 'in/out',
  method: 'payment mode',
  time: 'time',
};

const DEBIT_WORDS = /^(dr|d|debit|debited|expense|expenses|out|paid|spent|spend|withdrawal|payment|sent|outflow|-)$/i;
const CREDIT_WORDS = /^(cr|c|credit|credited|income|in|received|deposit|refund|salary|inflow|\+)$/i;
const SKIP_STATUS = /\b(fail(ed|ure)?|declined|cancel+ed|reversed|rejected)\b/i;
const TOTAL_RX = /^(grand\s*)?(sub\s*)?total\b|^(opening|closing)\s*balance\b|^balance\s*(b\/?f|c\/?f)\b|^(brought|carried)\s*forward\b/i;

function headerKey(cell) {
  if (cell == null || cell instanceof Date || typeof cell === 'number') return null;
  const text = norm(cell);
  if (!text || text.length > 40) return null;
  return HEADERS.find(([, rx]) => rx.test(text))?.[0] ?? null;
}

/** `{ value, sign, suffix }` for money-looking cells, else null. "(500)", "500 Dr", "-₹1,200.50" all work. */
export function parseMoney(cell) {
  if (cell == null || cell instanceof Date) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) && cell !== 0 ? { value: Math.abs(cell), sign: cell < 0 ? '-' : '', suffix: '' } : null;
  let s = String(cell).trim().toLowerCase();
  if (!s || s.length > 30) return null;
  let sign = '';
  let suffix = '';
  const sx = s.match(/\s*\(?\s*(dr|cr)\s*\)?\.?$/);
  if (sx) {
    suffix = sx[1];
    s = s.slice(0, sx.index);
  }
  const px = s.match(/^(dr|cr)\.?\s+/);
  if (px) {
    suffix = px[1];
    s = s.slice(px[0].length);
  }
  if (/^\(.*\)$/.test(s)) {
    sign = '-';
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|\brs\.?|\binr\b|\s/g, '');
  if (/^[+-]/.test(s)) {
    sign = s[0] === '-' ? '-' : '+';
    s = s.slice(1);
  }
  if (/-$/.test(s)) {
    sign = '-';
    s = s.slice(0, -1);
  }
  s = s.replace(/^[+-]/, '');
  if (!/^\d{1,3}(,\d{2,3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) return null;
  const value = Number(s.replace(/,/g, ''));
  return value > 0 ? { value, sign, suffix } : null;
}

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** A day without a year is this year, unless that would be in the future (then last year). */
function withoutYear(day, month, today) {
  const year = Number(today.slice(0, 4));
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const iso = isoOf(year, month, day);
  return Date.parse(iso) - Date.parse(today) > DAY_MS ? isoOf(year - 1, month, day) : iso;
}

/** `{ date, time }` from a cell; date is YYYY-MM-DD or null. */
export function parseDateCell(cell, today = todayISO()) {
  if (cell == null) return { date: null, time: null };
  if (cell instanceof Date) {
    // Excel dates arrive as local-time Dates.
    const time = cell.getHours() || cell.getMinutes() ? `${pad(cell.getHours())}:${pad(cell.getMinutes())}` : null;
    return { date: isoOf(cell.getFullYear(), cell.getMonth() + 1, cell.getDate()), time };
  }
  if (typeof cell === 'number') {
    if (cell > 20000 && cell < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * DAY_MS);
      return { date: d.toISOString().slice(0, 10), time: null };
    }
    return { date: null, time: null };
  }
  const text = String(cell);
  const time = findTime(text);
  const found = findDates(text)[0];
  if (found) return { date: found.iso, time };
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) return { date: today, time };
  if (/\byesterday\b/.test(lower)) return { date: new Date(Date.parse(today) - DAY_MS).toISOString().slice(0, 10), time };
  const dm = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s/-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (dm) return { date: withoutYear(Number(dm[1]), MONTHS[dm[2]], today), time };
  const md = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (md) return { date: withoutYear(Number(md[2]), MONTHS[md[1]], today), time };
  const num = lower.match(/^\s*(\d{1,2})[/.-](\d{1,2})\s*$/);
  if (num) return { date: withoutYear(Number(num[1]), Number(num[2]), today), time };
  return { date: null, time };
}

const text = (cell) => {
  if (cell == null) return '';
  if (cell instanceof Date) return '';
  return String(cell).trim();
};

const share = (values, test) => {
  const filled = values.filter((v) => v != null && v !== '');
  return filled.length ? filled.filter(test).length / filled.length : 0;
};
const isDateLike = (v) => v instanceof Date || (typeof v === 'string' && Boolean(parseDateCell(v).date));
const isSerialColumn = (values) => {
  const nums = values.filter((v) => typeof v === 'number' || /^\d+$/.test(String(v ?? '')));
  return nums.length > 2 && nums.every((v, i) => i === 0 || Number(v) - Number(nums[i - 1]) === 1);
};

function methodOf(value) {
  const t = norm(value);
  if (!t) return undefined;
  if (/\b(upi|gpay|google pay|phonepe|phone pe|paytm|bhim|supermoney|amazon pay|cred)\b/.test(t)) return 'upi';
  if (/\bcash\b/.test(t)) return 'cash';
  if (/\b(card|credit card|debit card|visa|master ?card|rupay|amex)\b/.test(t)) return 'card';
  if (/\b(neft|imps|rtgs|bank|net ?banking|transfer|cheque|chq)\b/.test(t)) return 'bank';
  return 'other';
}

/** Maps columns to fields, from a header row if there is one, otherwise from what the cells contain. */
function mapColumns(rows) {
  let best = { index: -1, score: 0, keys: [] };
  rows.slice(0, HEADER_SCAN_ROWS).forEach((row, index) => {
    const keys = row.map(headerKey);
    const score = keys.filter(Boolean).length;
    const hasMoney = keys.some((k) => MONEY_KEYS.includes(k));
    if (score >= 2 && hasMoney && score > best.score) best = { index, score, keys };
  });

  const headerIndex = best.index;
  const data = rows.slice(headerIndex + 1);
  const sample = data.slice(0, SAMPLE_ROWS);
  const column = (i) => sample.map((r) => r[i]);
  const width = Math.max(...rows.slice(0, HEADER_SCAN_ROWS).map((r) => r.length), 0);
  const cols = { description: [] };
  const headers = headerIndex >= 0 ? rows[headerIndex] : [];

  if (headerIndex >= 0) {
    best.keys.forEach((key, i) => {
      if (!key) return;
      if (key === 'description') cols.description.push(i);
      else if (cols[key] === undefined) cols[key] = i;
    });
    // A money title over words ("Expense: Petrol") is really a description.
    for (const key of [...MONEY_KEYS, 'balance']) {
      if (cols[key] === undefined) continue;
      const values = column(cols[key]);
      if (share(values, (v) => parseMoney(v)) < 0.6 && share(values, (v) => /[a-z]/i.test(text(v))) > 0.5) {
        cols.description.push(cols[key]);
        delete cols[key];
      }
    }
    if (cols.date !== undefined && share(column(cols.date), isDateLike) < 0.5) delete cols.date;
  }

  const used = () => new Set(Object.values(cols).flat().filter((v) => v !== undefined));
  if (!MONEY_KEYS.some((k) => cols[k] !== undefined)) {
    let pick = null;
    for (let i = 0; i < width; i++) {
      if (used().has(i)) continue;
      const values = column(i);
      const s = share(values, (v) => parseMoney(v) && !(v instanceof Date));
      if (s >= 0.7 && !isSerialColumn(values) && (!pick || s > pick.s)) pick = { i, s };
    }
    if (pick) cols.amount = pick.i;
  }
  if (cols.date === undefined) {
    for (let i = 0; i < width; i++) {
      if (used().has(i)) continue;
      if (share(column(i), isDateLike) >= 0.6) {
        cols.date = i;
        break;
      }
    }
  }
  if (!cols.description.length) {
    const texty = [];
    for (let i = 0; i < width; i++) {
      if (used().has(i)) continue;
      const values = column(i);
      const s = share(values, (v) => /[a-z]/i.test(text(v)) && !isDateLike(v));
      if (s >= 0.6) texty.push({ i, len: values.reduce((n, v) => n + text(v).length, 0) });
    }
    cols.description = texty
      .sort((a, b) => b.len - a.len)
      .slice(0, 2)
      .map((t) => t.i)
      .sort((a, b) => a - b);
  }

  const named = Object.fromEntries(
    Object.entries(LABELS)
      .map(([key, label]) => {
        const idx = key === 'description' ? cols.description[0] : cols[key];
        if (idx === undefined) return null;
        return [key, text(headers[idx]) || label];
      })
      .filter(Boolean),
  );
  return { cols, headerIndex, headers: headers.map(text).filter(Boolean), named };
}

function finishDescription(parts, place, fallback) {
  let description = parts.filter(Boolean).join(' · ');
  let reference = null;
  let paymentMethod;
  if (/\b(upi|neft|imps|rtgs)(\s?(cr|dr))?[/-]|\bpaid to\b|\breceived from\b/i.test(description)) {
    const d = describe(description);
    ({ description, reference, paymentMethod } = d);
  }
  if (place && !description.toLowerCase().includes(place.toLowerCase())) description = description ? `${description} · ${place}` : place;
  return { description: (description || fallback || 'Entry').slice(0, 120), reference, paymentMethod };
}

/**
 * Parses one table. Returns `{ rows, skipped, found, missing }`:
 * `found` names the columns used, `missing` lists what couldn't be found (e.g. 'amount').
 */
export function parseTable(table, { today = todayISO() } = {}) {
  const { cols, headerIndex, headers, named } = mapColumns(table.rows);
  const hasMoney = MONEY_KEYS.some((k) => cols[k] !== undefined);
  const missing = [];
  if (!hasMoney) missing.push('amount');
  if (cols.date === undefined) missing.push('date');
  if (!cols.description.length && cols.place === undefined && cols.category === undefined) missing.push('description');
  if (!hasMoney) {
    // No header was recognised, but a first row of plain words is still worth naming back to the user.
    const first = table.rows.find((r) => r.some((c) => text(c)));
    const looksLikeHeader = first?.every((c) => !text(c) || (/[a-z]/i.test(text(c)) && !parseMoney(c) && !isDateLike(c)));
    return { rows: [], skipped: [], found: named, headers: headers.length || !looksLikeHeader ? headers : first.map(text).filter(Boolean), missing };
  }

  const data = table.rows.slice(headerIndex + 1);
  const signed = cols.amount !== undefined && data.some((r) => parseMoney(r[cols.amount])?.sign === '-');
  const typed = cols.type !== undefined || cols.debit !== undefined || cols.credit !== undefined || signed;
  const rows = [];
  const skipped = [];

  data.forEach((row, i) => {
    const line = headerIndex + i + 2;
    const raw = row.map((c) => (c instanceof Date ? parseDateCell(c).date : text(c))).filter(Boolean).join(' | ');
    const descParts = cols.description.map((c) => text(row[c]));
    const label = descParts.filter(Boolean).join(' ');
    if (TOTAL_RX.test(label) || TOTAL_RX.test(text(row[0]))) return;
    if (cols.status !== undefined && SKIP_STATUS.test(text(row[cols.status]))) {
      skipped.push({ line, reason: 'Failed or cancelled payment', text: raw });
      return;
    }

    const debit = cols.debit !== undefined ? parseMoney(row[cols.debit]) : null;
    const credit = cols.credit !== undefined ? parseMoney(row[cols.credit]) : null;
    const plain = cols.amount !== undefined ? parseMoney(row[cols.amount]) : null;
    let amount = null;
    let type = null;
    let typeSource = 'statement';
    if (debit) [amount, type] = [debit, 'debit'];
    else if (credit) [amount, type] = [credit, 'credit'];
    else if (plain) {
      amount = plain;
      const kind = text(row[cols.type]).replace(/\.$/, '');
      if (plain.suffix === 'dr' || DEBIT_WORDS.test(kind)) type = 'debit';
      else if (plain.suffix === 'cr' || CREDIT_WORDS.test(kind)) type = 'credit';
      else if (signed) type = plain.sign === '-' ? 'debit' : 'credit';
      else if (plain.sign === '+') type = 'credit';
    }
    if (!amount) {
      if (raw) skipped.push({ line, reason: 'No amount', text: raw });
      return;
    }
    if (!type) {
      const hint = textHint(label);
      if (hint?.type === 'credit' && hint.strength >= 2) type = 'credit';
      else {
        type = 'debit';
        typeSource = typed ? 'guess' : 'assumed';
      }
    }

    const when = cols.date !== undefined ? parseDateCell(row[cols.date], today) : { date: null, time: null };
    const time = (cols.time !== undefined ? findTime(text(row[cols.time])) : null) ?? when.time;
    const fileCategory = cols.category !== undefined ? text(row[cols.category]) : '';
    const place = cols.place !== undefined ? text(row[cols.place]) : '';
    const { description, reference, paymentMethod } = finishDescription(descParts, place, fileCategory);

    rows.push({
      date: when.date ?? today,
      dateMissing: !when.date || undefined,
      time: time ?? null,
      amount: Math.round(amount.value * 100) / 100,
      type,
      typeSource,
      description,
      reference: (cols.ref !== undefined && text(row[cols.ref]).match(/[a-z0-9]{6,}/i)?.[0]) || reference || findReference(raw),
      paymentMethod: (cols.method !== undefined ? methodOf(row[cols.method]) : undefined) ?? paymentMethod,
      fileCategory: fileCategory ? titleCase(fileCategory).slice(0, 40) : undefined,
      payFrom: cols.account !== undefined ? text(row[cols.account]) || null : null,
      raw: raw.slice(0, 300),
    });
  });
  return { rows, skipped, found: named, headers, missing };
}

const LOOSE_AMOUNT_RX = /(?<![\w/.:-])([+-])?\s?(₹|rs\.?|inr)?\s?(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\w/:%-]|\.\d)\s?(\/-|rs|rupees|inr)?/gi;

/** Free text, one entry per line: "Petrol 500", "12 Oct Lunch with Ravi ₹350", "+2000 salary". */
export function parseLooseLines(lines, { today = todayISO() } = {}) {
  const rows = [];
  const skipped = [];
  lines.forEach((line, i) => {
    if (TOTAL_RX.test(line.trim())) return;
    const dates = findDates(line);
    let rest = line;
    for (const d of [...dates].sort((a, b) => b.index - a.index)) rest = `${rest.slice(0, d.index)} ${rest.slice(d.index + d.length)}`;
    rest = rest.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:[ap]\.?m\.?)?/gi, ' ');
    const candidates = [...rest.matchAll(LOOSE_AMOUNT_RX)].map((m) => ({
      index: m.index,
      length: m[0].length,
      sign: m[1] ?? '',
      marked: Boolean(m[2] || m[4]),
      value: Number(m[3].replace(/,/g, '')),
    }));
    // A bare year ("Trip expenses 2026") isn't an amount.
    const usable = candidates.filter((c) => c.value > 0 && (c.marked || c.sign || !(Number.isInteger(c.value) && c.value >= 1990 && c.value <= 2100)));
    const amount = usable.find((c) => c.marked) ?? usable.pop();
    const words = rest.replace(/[^a-z]/gi, '');
    if (!amount || !words) {
      if (/[a-z]/i.test(line) && /\d/.test(line)) skipped.push({ line: i + 1, reason: 'No amount', text: line.slice(0, 200) });
      return;
    }
    const description = rest
      .slice(0, amount.index)
      .concat(' ', rest.slice(amount.index + amount.length))
      .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?=\s|$)|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi, ' ')
      .replace(/\b(today|yesterday|on|for|at|rs\.?|inr|rupees)\b/gi, ' ')
      .replace(/[-–:,;|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const when = dates[0] ? { date: dates[0].iso, time: findTime(line) } : parseDateCell(line, today);
    const hint = textHint(line);
    const type = amount.sign === '+' || (hint?.type === 'credit' && hint.strength >= 2) ? 'credit' : 'debit';
    rows.push({
      date: when.date ?? today,
      dateMissing: !when.date || undefined,
      time: when.time ?? null,
      amount: Math.round(amount.value * 100) / 100,
      type,
      typeSource: amount.sign || hint ? 'statement' : 'assumed',
      description: (description ? titleCase(description) : 'Entry').slice(0, 120),
      reference: findReference(line),
      paymentMethod: methodOf(line) === 'other' ? undefined : methodOf(line),
      raw: line.slice(0, 300),
    });
  });
  return { rows, skipped };
}
