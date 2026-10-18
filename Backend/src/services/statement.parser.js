// Rule-based reader for bank and UPI-app statements (text already extracted from the PDF).
// Each transaction starts on a line that begins with a date; following lines without a
// date (wrapped descriptions, time, reference numbers) belong to it. Histories laid out as a
// titled table (Name / Amount / Date / Status…) are read column by column instead.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const monthNo = (name) => MONTHS[name.toLowerCase().slice(0, 3)];

const DATE_PATTERNS = [
  { rx: /\b(\d{4})-(\d{2})-(\d{2})\b/g, ymd: (m) => [m[1], m[2], m[3]] },
  { rx: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g, ymd: (m) => [m[3], m[2], m[1]] },
  { rx: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s/-]*${MON}[\\s/,'-]*(\\d{4}|\\d{2})\\b`, 'gi'), ymd: (m) => [m[3], monthNo(m[2]), m[1]] },
  { rx: new RegExp(`\\b${MON}\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})\\b`, 'gi'), ymd: (m) => [m[3], monthNo(m[1]), m[2]] },
];

const TIME_RX = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s?([ap]\.?m\.?)?(?![\d:])/i;
// A row starts with a date near the left edge (serial numbers or a weekday may come first).
const ROW_DATE_MAX_INDEX = 24;
const MAX_EXTRA_LINES = 4;
// Some banks (Canara) centre the particulars cell, so its first lines print above the date row.
const MAX_LINES_ABOVE = 6;
const NARRATION_START_RX = /^(upi|neft|imps|rtgs|ach|nach|ecs|mmt|atm|pos)\s*[/-]|^(by|to)\s+(transfer|clg|cash)\b/i;
const NARRATION_RX = /\b(upi|neft|imps|rtgs)[/-]/i;
const ROW_END_RX = /^chq\b/i;

const NOISE_RX =
  /\b(page\s*\d+(\s*(of|\/)\s*\d+)?|computer generated|does not require|signature|customer care|toll free|www\.|https?:|e-?mail|disclaimer|registered office|cin\s*:|gstin|ifsc\s*code|micr|statement of account|account statement|account (number|no)|branch|nominee|address)\b/i;
const SUMMARY_RX =
  /\b(opening\s*bal(ance)?|closing\s*bal(ance)?|balance\s*(b\/?f|c\/?f|brought|carried)|brought\s*forward|carried\s*forward|b\/f|c\/f|grand\s*total|total\s*(debits?|credits?|withdrawals?|deposits?)?)\b/i;
const OPENING_RX = /\b(opening\s*bal(ance)?|brought\s*forward|balance\s*b\/?f|b\/f)\b/i;
const HEADER_RX =
  /\b(txn|tran(saction)?|value|posting)\s*date\b|\bparticulars\b|\bnarration\b|\bwithdrawals?\b.*\bdeposits?\b|\bdebit\b.*\bcredit\b.*\bbalance\b/i;
// Marks where a wrapped line was joined, so split UPI strings can be stitched back together.
const JOIN = '\u0001';
const CELL_GAP = /\s{3,}/;

// Column titles of table-style histories (UPI apps: "Name  Bank  Amount  Date  Status").
const COLUMNS = {
  date: /^((txn|transaction|value|posting)\s+)?date(\s*(&|and)\s*time)?$/i,
  time: /^time$/i,
  amount: /^((txn|transaction)\s+)?amount(\s*\(.*\))?$/i,
  name: /^(name|description|details|particulars|narration|remarks|paid to|to|from|to\s*\/\s*from|merchant|payee|beneficiary)$/i,
  status: /^status$/i,
  kind: /^(type|dr\s*\/\s*cr|cr\s*\/\s*dr|debit\s*\/\s*credit)$/i,
  account: /^(bank|account|bank account|paid (from|via)|payment (source|mode))$/i,
  ref: /^(utr|rrn|ref(erence)?(\s+(no|number))?|upi ref(\s+no)?|transaction id|txn id)$/i,
};
const SKIP_STATUS_RX = /\b(fail(ed|ure)?|declined|cancel+ed|reversed|rejected)\b/i;
const EMPTY_NAME_RX = /^(null|undefined|none|na|n\/a|-+)?$/i;

/** Column keys for a header line, or null if it isn't a table header we can use. */
function tableColumns(line) {
  const cells = line.split(CELL_GAP).map((c) => c.trim());
  if (cells.length < 3) return null;
  const keys = cells.map((c) => Object.keys(COLUMNS).find((k) => COLUMNS[k].test(c)) ?? null);
  if (!keys.includes('date') || !keys.includes('amount')) return null;
  return keys.filter(Boolean).length >= cells.length - 1 ? keys : null;
}

/** A dated line with no money that only spans a period ("1 October 2026 to 18 October 2026"). */
function isPeriodLine(line, dates) {
  if (dates.length < 2) return false;
  const leftover = stripRanges(line, dates).replace(/\b(from|to|till|until|period|statement|for|between|and)\b|[-–:,]/gi, '');
  return !leftover.trim();
}
function toISO(y, m, d) {
  let year = Number(y);
  if (year < 100) year += 2000;
  const month = Number(m);
  const day = Number(d);
  if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function findDates(text) {
  const found = [];
  for (const { rx, ymd } of DATE_PATTERNS) {
    rx.lastIndex = 0;
    for (const m of text.matchAll(rx)) {
      const iso = toISO(...ymd(m));
      if (iso) found.push({ iso, index: m.index, length: m[0].length });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function stripRanges(text, ranges) {
  let out = text;
  for (const r of [...ranges].sort((a, b) => b.index - a.index)) {
    out = `${out.slice(0, r.index)} ${out.slice(r.index + r.length)}`;
  }
  return out;
}

const AMOUNT_RX = /(?<![\w/.:@-])([+-])?\s?(₹|rs\.?|inr)?\s?(\d[\d,]*(?:\.\d{1,2})?)(?![\w/@]|\.\d)(?:\s?\(?(cr|dr)\)?(?![a-z]))?/gi;

/** Money-looking numbers: with paise, Indian digit grouping, or a ₹/Rs/INR prefix. Reference numbers don't qualify. */
function scanAmounts(text) {
  const out = [];
  for (const m of text.matchAll(AMOUNT_RX)) {
    const [, sign, currency, digits, suffix] = m;
    const hasPaise = /\.\d{1,2}$/.test(digits);
    const grouped = /^\d{1,3}(,\d{2,3})+(\.\d{1,2})?$/.test(digits);
    if (!hasPaise && !grouped && !currency) continue;
    if (digits.includes(',') && !grouped) continue;
    const value = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    out.push({ value, sign: sign ?? '', suffix: suffix?.toLowerCase() ?? '', currency: Boolean(currency), index: m.index, length: m[0].length });
  }
  return out;
}

const CREDIT_HINTS = [
  [/\bupi\/cr\b|\/cr\/|\bby transfer\b|\bneft\/cr\b|\bimps\/cr\b/i, 3],
  [/\b(received from|money received|credited|refund|reversal|reversed|cashback|salary|interest (paid|credit)|deposit)\b/i, 2],
  [/\b(credit|cr)\b/i, 1],
];
const DEBIT_HINTS = [
  [/\bupi\/dr\b|\/dr\/|\bto transfer\b|\bneft\/dr\b|\bimps\/dr\b/i, 3],
  [/\b(paid to|sent to|money sent|debited|purchase|pos|atm|withdrawal|bill ?pay|autopay|mandate)\b/i, 2],
  [/\b(debit|dr)\b/i, 1],
];

export function textHint(text) {
  const score = (hints) => hints.reduce((best, [rx, w]) => (rx.test(text) ? Math.max(best, w) : best), 0);
  const credit = score(CREDIT_HINTS);
  const debit = score(DEBIT_HINTS);
  if (credit === debit) return null;
  return credit > debit ? { type: 'credit', strength: credit } : { type: 'debit', strength: debit };
}

const BANK_CODE_RX = /^[A-Z]{4}(0[A-Z0-9]{6})?$/;
const GENERIC_SEGMENT_RX =
  /^(upi|dr|cr|p2a|p2m|p2p|neft|imps|rtgs|(?:upi|neft|imps|rtgs) ?(?:cr|dr)|mob|collect|pay|payment|payment from phone|sent using paytm upi|upi ?intent|pay ?to\b.*|pay ?tob|na|null|none|ok|to transfer|by transfer|transfer|paid|paid ?via|pay ?via|sent ?via|via|chq:?.*)$/i;

/** Pulls a readable name, reference and note out of strings like `UPI/DR/412345678901/SWIGGY/YESB/swiggy@yesbank/Food`. */
function parseSegments(text) {
  // Runs until a column gap (2+ spaces), so names with single spaces stay whole.
  const match = text.match(/(?:\b(?:to|by) transfer-)?\b(upi|neft|imps|rtgs)(?:\s?(?:cr|dr))?[/-].*?(?=\s{2,}|$)/i);
  if (!match) return null;
  const parts = match[0].split(/[/-]/).map((s) => s.trim()).filter(Boolean);
  let reference = null;
  let vpa = null;
  const words = [];
  for (const part of parts) {
    if (/^\d{8,}$/.test(part) || /^[a-z]{4}[a-z0-9]?\d{8,}$/i.test(part)) {
      reference ??= part;
      continue;
    }
    if (part.includes('@')) {
      vpa ??= part;
      continue;
    }
    if (/^\d+$/.test(part) || GENERIC_SEGMENT_RX.test(part) || BANK_CODE_RX.test(part) || !/[a-z]/i.test(part)) continue;
    // App transaction ids like "SMY2602262224HWZY9", and masked bits of a VPA ("**N").
    if ((/\d/.test(part) && part.length >= 10 && !/\s/.test(part)) || part.includes('*')) continue;
    words.push(part);
  }
  if (!words.length && !vpa) return null;
  const name = words[0] ?? vpa.split('@')[0];
  // Banks cut names short, so "SUPERMON" after "SUPERMONEY" is the same word, not a note.
  const sameWord = (a, b) => a.toLowerCase().replace(/\s/g, '').startsWith(b.toLowerCase().replace(/\s/g, ''));
  const note = words.slice(1).find((w) => w.length > 2 && !sameWord(name, w) && !sameWord(w, name));
  return { name, note, reference, vpa };
}

export const titleCase = (s) =>
  /[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

function cleanText(text) {
  return text
    .replace(/\b(upi\s*ref(erence)?\s*(no|number)?|utr\s*(no|number)?|transaction\s*id|txn\s*id|order\s*id|ref\s*(no|number)?|rrn)\b[\s.:#-]*[a-z0-9]{6,}/gi, ' ')
    .replace(/\b(debited from|credited to)\b.*$/i, ' ')
    .replace(/\b[\dx*]*[x*]{3,}[\dx*]*\b/gi, ' ')
    .replace(/^\s*(pos|ecom|pur|purchase)\b[\s/:-]*/i, '')
    .replace(/\b[a-z0-9]*\d{9,}[a-z0-9]*\b/gi, ' ')
    .replace(/\b(debit|credit|dr|cr|chq|cheque|value date|tran(saction)? date|narration|particulars)\b\.?/gi, ' ')
    .replace(/[|•·]/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:/-]+|[\s,.;:/-]+$/g, '')
    .trim();
}

export function findReference(text) {
  return (
    text.match(/\b(?:upi\s*ref(?:erence)?|utr|rrn|ref)\b(?:\s*(?:no|number))?[\s.:#-]*(\d{10,22})\b/i)?.[1] ??
    text.match(/(?<!\d)(\d{12})(?!\d)/)?.[1] ??
    null
  );
}

function paymentMethodOf(text) {
  if (/\bupi\b|@|\bpaid to\b|\breceived from\b/i.test(text)) return 'upi';
  if (/\b(pos|card|ecom|visa|mastercard|rupay)\b/i.test(text)) return 'card';
  if (/\b(atm|cash)\b/i.test(text)) return 'cash';
  return 'bank';
}

/** Turns raw statement text into `{ description, reference, paymentMethod }`. */
export function describe(rawText) {
  const segments = parseSegments(rawText);
  const reference = segments?.reference ?? findReference(rawText);
  let description;
  if (segments) {
    description = titleCase(segments.name);
    if (segments.note && !/^upi$/i.test(segments.note)) description += ` · ${titleCase(segments.note)}`;
  } else {
    const phrase = rawText.match(/\b(paid to|sent to|received from|money sent to|money received from|transfer(?:red)? to|transfer(?:red)? from)\s+(.+?)(?=\s{3}|\s+(?:upi|transaction|txn|ref|utr|debited|credited)\b|$)/i);
    description = titleCase(cleanText(phrase ? phrase[2] : rawText));
  }
  if (/\batm\b/i.test(rawText) && /\b(wdl|withdrawal|cash|nfs)\b/i.test(rawText)) description = 'ATM cash withdrawal';
  return {
    description: description.slice(0, 120) || 'Bank entry',
    reference,
    paymentMethod: paymentMethodOf(rawText),
  };
}

/** Normalised merchant/person name used to remember categories ("SWIGGY LIMITED" → "swiggy"). */
export function merchantKey(description) {
  const key = (description ?? '')
    .split('·')[0]
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|llp|india|technologies|technology|tech|services|solutions|retail|online|the|and|co|inc|payments?|upi|mr|mrs|ms)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key.length >= 2 ? key.slice(0, 60) : null;
}

function tableBlock(line, columns) {
  const cells = line.split(CELL_GAP).map((c) => c.trim());
  if (cells.length !== columns.length) return null;
  const table = {};
  columns.forEach((key, i) => {
    if (key) table[key] = cells[i];
  });
  const date = findDates(table.date)[0];
  if (!date || !/\d/.test(table.amount)) return null;
  return { date: date.iso, lines: [line], table };
}

function splitBlocks(lines, widths) {
  const blocks = [];
  let current = null;
  let columns = null;
  let above = [];
  for (const [index, line] of lines.entries()) {
    const header = tableColumns(line);
    if (header) {
      columns = header;
      current = null;
      continue;
    }
    if (columns) {
      const block = tableBlock(line, columns);
      if (block) {
        current = block;
        blocks.push(block);
        continue;
      }
      // A long name can wrap onto its own line under the row.
      if (current?.table && !findDates(line).length && !NOISE_RX.test(line) && current.lines.length <= MAX_EXTRA_LINES) {
        current.table.name = `${current.table.name ?? ''} ${line.trim()}`.trim();
        current.lines.push(line);
        continue;
      }
    }
    // A page header may split a centred cell, so lines waiting for their date row survive it.
    if (HEADER_RX.test(line) && !scanAmounts(line).length) {
      current = null;
      continue;
    }
    if (SUMMARY_RX.test(line)) {
      // The opening balance anchors the first row's money-in/out check.
      const amounts = scanAmounts(stripRanges(line, findDates(line))).filter((a) => a.value > 0);
      if (OPENING_RX.test(line) && amounts.length) blocks.push({ opening: true, balance: amounts[amounts.length - 1].value });
      current = null;
      above = [];
      continue;
    }
    const dates = findDates(line);
    if (isPeriodLine(line, dates)) {
      current = null;
      above = [];
      continue;
    }
    const firstDate = dates[0];
    // Inside a centred cell, a dated line without money ("DATED 20-SEP-26", "01/09/2026 20:53") is narration.
    if (firstDate && (above.length || (current?.above && !current.closed)) && !scanAmounts(stripRanges(line, dates)).some((a) => a.value > 0)) {
      if (above.length) {
        if (above.length < MAX_LINES_ABOVE) above.push({ text: line.trim(), width: widths?.[index] ?? line.trim().length });
      } else if (current.lines.length - current.above <= MAX_EXTRA_LINES) {
        current.lines.push(line);
      }
      continue;
    }
    if (firstDate && firstDate.index <= ROW_DATE_MAX_INDEX && !NOISE_RX.test(line.slice(0, firstDate.index))) {
      current = {
        date: firstDate.iso,
        lines: [...above.map((a) => a.text), line],
        above: above.length,
        aboveWidths: above.map((a) => a.width),
      };
      current.narrated = above.length > 0 || NARRATION_RX.test(line);
      blocks.push(current);
      above = [];
      continue;
    }
    if (NOISE_RX.test(line) || line.length > 160) continue;
    if (above.length || current?.closed || (NARRATION_START_RX.test(line) && (!current || current.narrated))) {
      if (above.length < MAX_LINES_ABOVE) above.push({ text: line.trim(), width: widths?.[index] ?? line.trim().length });
      continue;
    }
    if (!current || current.lines.length - current.above > MAX_EXTRA_LINES) continue;
    current.lines.push(line);
    if (ROW_END_RX.test(line)) current.closed = true;
  }
  return blocks;
}

export function findTime(text) {
  const m = text.match(TIME_RX);
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = m[3]?.toLowerCase().replace(/\./g, '');
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h < 24 && Number(m[2]) < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

const TABLE_AMOUNT_RX = /^([+-])?\s*(?:₹|rs\.?|inr)?\s*([+-])?\s*(\d[\d,]*(?:\.\d+)?)\s*\(?(cr|dr)?\)?$/i;
const KIND_DEBIT_RX = /^(dr|debit(ed)?|paid|sent|withdrawal|payment)$/i;
const KIND_CREDIT_RX = /^(cr|credit(ed)?|received|deposit|refund)$/i;

function parseTableBlock({ date, table, lines }) {
  if (table.status && SKIP_STATUS_RX.test(table.status)) return null;
  const m = table.amount.trim().match(TABLE_AMOUNT_RX);
  if (!m) return null;
  const value = Number(m[3].replace(/,/g, ''));
  if (!(value > 0)) return null;
  const sign = m[1] ?? m[2] ?? '';
  const suffix = m[4]?.toLowerCase();
  const kind = table.kind?.trim() ?? '';
  const name = EMPTY_NAME_RX.test(table.name?.trim() ?? '') ? '' : table.name.trim();
  const raw = lines.join('   ').replace(/\s{2,}/g, ' ').slice(0, 300);

  let hint = null;
  if (sign === '-' || suffix === 'dr' || KIND_DEBIT_RX.test(kind)) hint = { type: 'debit', strength: 4 };
  else if (sign === '+' || suffix === 'cr' || KIND_CREDIT_RX.test(kind)) hint = { type: 'credit', strength: 4 };
  else if (name) hint = textHint(name);

  const described = name ? describe(name) : null;
  return {
    date,
    time: findTime(table.time ?? '') ?? findTime(table.date) ?? findTime(raw),
    amount: Math.round(value * 100) / 100,
    balance: null,
    hint,
    tableSign: sign || suffix || (kind ? 'kind' : ''),
    description: described?.description ?? 'Unnamed payment',
    reference: table.ref?.match(/[a-z0-9]{8,}/i)?.[0] ?? described?.reference ?? findReference(raw),
    // UPI-app histories list the paying bank account and a status column.
    paymentMethod: table.account && table.status ? 'upi' : (described?.paymentMethod ?? 'bank'),
    payFrom: table.account || null,
    raw,
  };
}

/**
 * Merges the lines printed above the date row into one narration. The bank wraps at a space
 * when the next word won't fit ("OM" + "KIRAN") and cuts mid-word only on a full line
 * ("…/PAYM" + "ENT"). `cellWidth` is the widest such line in the statement.
 */
function joinAbove({ lines, above = 0, aboveWidths = [] }, cellWidth) {
  if (!above) return lines;
  const top = lines.slice(0, above);
  const narration = top.reduce((text, line, i) => {
    if (!i) return line;
    const prev = top[i - 1];
    const charWidth = aboveWidths[i - 1] / Math.max(prev.length, 1);
    const full = aboveWidths[i - 1] >= cellWidth - 1.5 * charWidth;
    const nextWord = (aboveWidths[i] / Math.max(line.length, 1)) * line.split(' ')[0].length;
    const brokeAtSpace = !full && aboveWidths[i - 1] + charWidth + nextWord > cellWidth;
    return text + (brokeAtSpace ? ' ' : '') + line;
  }, '');
  return [narration, ...lines.slice(above)];
}

function parseBlock(block, cellWidth) {
  if (block.opening) return { opening: true, amount: 0, balance: block.balance };
  if (block.table) return parseTableBlock(block);
  const joined = joinAbove(block, cellWidth)
    .filter((l) => !ROW_END_RX.test(l))
    .join(JOIN);
  const raw = joined.replaceAll(JOIN, '   ');
  const time = findTime(raw);

  let rest = stripRanges(joined, findDates(joined));
  rest = rest.replace(new RegExp(TIME_RX.source, 'gi'), ' ');
  const amounts = scanAmounts(rest);
  const money = amounts.filter((a) => a.value > 0);
  if (!money.length) return null;

  // Bank layout: [withdrawal] [deposit] balance. A zero/blank cell tells which side it is.
  let amount = money[0];
  let balance = null;
  let columnHint = null;
  if (amounts.length >= 3 && amounts.slice(0, 2).some((a) => a.value === 0)) {
    const [first, second] = amounts;
    amount = first.value > 0 ? first : second;
    columnHint = first.value > 0 ? 'debit' : 'credit';
    balance = amounts[amounts.length - 1].value;
  } else if (money.length >= 2) {
    amount = money[0];
    balance = money[money.length - 1].value;
  }

  let hint = null;
  if (amount.sign === '-' || amount.suffix === 'dr') hint = { type: 'debit', strength: 4 };
  else if (amount.sign === '+' || amount.suffix === 'cr') hint = { type: 'credit', strength: 4 };
  else if (columnHint) hint = { type: columnHint, strength: 3 };
  else hint = textHint(raw);

  // UPI strings have no spaces, so a wrapped one ("UPI/DR/4123/SWIG" + "GY/YESB/…") is glued back.
  const stripped = stripRanges(rest, amounts);
  const text = /\b(upi|neft|imps|rtgs)\//i.test(stripped)
    ? stripped.replace(new RegExp(`(?<=[\\w@./-])\\s*${JOIN}\\s*(?=[\\w@./-])`, 'g'), '').replaceAll(JOIN, ' ')
    : stripped.replaceAll(JOIN, '   ');
  const { description, reference, paymentMethod } = describe(text);
  return {
    date: block.date,
    time,
    amount: Math.round(amount.value * 100) / 100,
    balance,
    hint,
    description,
    reference,
    paymentMethod,
    raw: raw.replace(/\s{2,}/g, ' ').slice(0, 300),
  };
}

const near = (a, b) => Math.abs(a - b) < 0.011;

/** Uses the running balance to tell money in from money out; statements may be oldest- or newest-first. */
function inferFromBalance(rows) {
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < rows.length; i++) {
    const [prev, cur] = [rows[i - 1], rows[i]];
    if (prev.balance == null || cur.balance == null) continue;
    if (near(Math.abs(cur.balance - prev.balance), cur.amount)) asc++;
    if (near(Math.abs(prev.balance - cur.balance), prev.amount)) desc++;
  }
  if (!asc && !desc) return;
  for (let i = 1; i < rows.length; i++) {
    const [prev, cur] = [rows[i - 1], rows[i]];
    if (prev.balance == null || cur.balance == null) continue;
    if (asc >= desc && near(Math.abs(cur.balance - prev.balance), cur.amount)) {
      cur.balanceType = cur.balance > prev.balance ? 'credit' : 'debit';
    } else if (desc > asc && near(Math.abs(prev.balance - cur.balance), prev.amount)) {
      prev.balanceType = prev.balance > cur.balance ? 'credit' : 'debit';
    }
  }
}

/**
 * Returns `{ rows, lowConfidence }`. Each row: date, time, amount, type, typeSource
 * ('balance' | 'statement' | 'guess'), description, reference, paymentMethod, raw.
 */
export function parseStatement(lines, widths) {
  const blocks = splitBlocks(lines, widths);
  const cellWidth = Math.max(0, ...blocks.flatMap((b) => b.aboveWidths ?? []));
  const parsed = blocks.map((b) => parseBlock(b, cellWidth)).filter(Boolean);
  inferFromBalance(parsed);
  const rows = parsed.filter((r) => !r.opening);
  // In a table where spends carry a minus, an unsigned amount is money in.
  const signedTable = rows.some((r) => r.tableSign === '-');

  for (const row of rows) {
    if (signedTable && row.tableSign === '' && !(row.hint?.strength >= 2)) row.hint = { type: 'credit', strength: 2 };
    delete row.tableSign;
    if (row.balanceType) {
      row.type = row.balanceType;
      row.typeSource = 'balance';
    } else if (row.hint) {
      row.type = row.hint.type;
      row.typeSource = row.hint.strength >= 2 ? 'statement' : 'guess';
    } else {
      row.type = 'debit';
      row.typeSource = 'guess';
    }
    delete row.hint;
    delete row.balanceType;
    delete row.balance;
  }

  const guessed = rows.filter((r) => r.typeSource === 'guess').length;
  return { rows, lowConfidence: rows.length === 0 || guessed / rows.length > 0.3 };
}
