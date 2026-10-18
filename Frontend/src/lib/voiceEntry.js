import { localISODate, round2 } from './format';

const CREDIT_WORDS = /\b(received|receive|got|get|earned|credited|salary|income|refund(?:ed)?|cashback|bonus|stipend|sold)\b/i;
const TRANSFER_WORDS = /\b(transfer(?:red)?|moved|withdrew|withdrawn|withdraw)\b/i;

const KEYWORDS = {
  Food: /\b(food|lunch|dinner|breakfast|snacks?|chai|tea|coffee|swiggy|zomato|biryani|pizza|burger|restaurant|hotel|cafe|juice|meal|dosa|idli)\b/i,
  Groceries: /\b(grocer(?:y|ies)|vegetables?|veggies|fruits?|milk|dmart|big ?basket|blinkit|zepto|instamart|supermarket|kirana)\b/i,
  Transport: /\b(petrol|diesel|fuel|uber|ola|rapido|auto|cab|taxi|bus|metro|train ticket|parking|toll|fastag)\b/i,
  Shopping: /\b(shopping|amazon|flipkart|myntra|clothes|shirt|shoes|dress|ajio|meesho)\b/i,
  Bills: /\b(bill|electricity|current bill|water bill|gas|cylinder|wifi|broadband|internet|recharge|mobile|phone bill|dth)\b/i,
  Rent: /\b(rent|house rent|pg)\b/i,
  Entertainment: /\b(movie|movies|cinema|pvr|inox|concert|game|games|party|outing)\b/i,
  Health: /\b(medicine|medicines|medical|doctor|hospital|pharmacy|clinic|gym|tablets?|apollo)\b/i,
  Education: /\b(fees?|course|books?|tuition|college|school|exam|udemy)\b/i,
  Travel: /\b(flight|trip|travel|hotel booking|train|irctc|vacation|holiday|makemytrip)\b/i,
  Subscriptions: /\b(netflix|prime|hotstar|spotify|youtube premium|subscription|icloud|google one)\b/i,
  Salary: /\b(salary|stipend|payroll)\b/i,
  Freelance: /\b(freelance|client|project payment|gig)\b/i,
  Refund: /\b(refund(?:ed)?|cashback)\b/i,
  Gift: /\b(gift|birthday money)\b/i,
  Investment: /\b(dividend|interest|mutual fund|stocks?|returns?)\b/i,
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SMALL_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const shiftDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localISODate(d);
};

/** "450", "1,200.50", "2k", "1.5 lakh", "2 thousand" → rupees, with the matched text. */
function findAmount(text) {
  const rx = /(?:₹|\$|rs\.?|rupees?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?)?\s*(?:₹|rs\.?|rupees?|bucks)?/gi;
  for (const m of text.matchAll(rx)) {
    const raw = m[1].replace(/,/g, '');
    let n = Number(raw);
    if (!(n > 0)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    // Skip day numbers in dates like "on 5th" or "5 October".
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12).toLowerCase();
    if (!unit && /^(st|nd|rd|th)\b/.test(after)) continue;
    if (!unit && MONTHS.some((mo) => after.trimStart().startsWith(mo)) && n <= 31) continue;
    if (unit === 'k' || unit === 'thousand') n *= 1000;
    else if (unit.startsWith('lakh') || unit.startsWith('lac')) n *= 100000;
    else if (unit.startsWith('crore')) n *= 10000000;
    return { amount: round2(n), match: m[0] };
  }
  return null;
}

function findDate(text) {
  const t = text.toLowerCase();
  if (/\bday before yesterday\b/.test(t)) return { date: shiftDays(2), match: /\bday before yesterday\b/i };
  if (/\byesterday\b/.test(t)) return { date: shiftDays(1), match: /\byesterday\b/i };
  if (/\btoday\b/.test(t)) return { date: shiftDays(0), match: /\btoday\b/i };
  const ago = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten) days? ago\b/);
  if (ago) return { date: shiftDays(Number(ago[1]) || SMALL_NUMBERS[ago[1]]), match: new RegExp(ago[0], 'i') };
  const wd = t.match(/\b(?:last |on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    const diff = (new Date().getDay() - WEEKDAYS.indexOf(wd[1]) + 7) % 7 || 7;
    return { date: shiftDays(diff), match: new RegExp(wd[0], 'i') };
  }
  const dm = t.match(/\b(?:on )?(\d{1,2})(?:st|nd|rd|th)?(?: of)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  const md = t.match(/\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?\b/);
  const onDay = t.match(/\bon (?:the )?(\d{1,2})(?:st|nd|rd|th)\b/);
  const now = new Date();
  let day;
  let month = now.getMonth();
  let m;
  if (dm) [m, day, month] = [dm[0], Number(dm[1]), MONTHS.indexOf(dm[2])];
  else if (md) [m, day, month] = [md[0], Number(md[2]), MONTHS.indexOf(md[1])];
  else if (onDay) [m, day] = [onDay[0], Number(onDay[1])];
  if (day >= 1 && day <= 31) {
    let d = new Date(now.getFullYear(), month, day);
    if (d > now) d = onDay && !dm && !md ? new Date(now.getFullYear(), month - 1, day) : new Date(now.getFullYear() - 1, month, day);
    return { date: localISODate(d), match: new RegExp(m, 'i') };
  }
  return null;
}

function findCategory(text, type, categories) {
  const options = categories?.[type] ?? [];
  const named = options.find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  if (named) return named;
  const hit = Object.entries(KEYWORDS).find(([cat, rx]) => options.some((o) => o.toLowerCase() === cat.toLowerCase()) && rx.test(text));
  return hit ? options.find((o) => o.toLowerCase() === hit[0].toLowerCase()) : null;
}

function findMethod(text) {
  if (/\b(cash)\b/i.test(text)) return 'cash';
  if (/\b(credit card|debit card|card)\b/i.test(text)) return 'card';
  if (/\b(upi|gpay|google pay|phonepe|phone pe|paytm|bhim)\b/i.test(text)) return 'upi';
  if (/\b(net ?banking|neft|imps|bank transfer)\b/i.test(text)) return 'bank';
  return null;
}

function findSplit(text) {
  const m = text.match(/\bsplit(?:ting)?(?: it| this)? (?:with|between|among) (.+?)(?:\.|$| equally| for | on | yesterday| today)/i);
  if (!m) return null;
  const names = m[1]
    .split(/,|\band\b|&/i)
    .map((s) => s.replace(/\b(me|myself)\b/gi, '').trim())
    .filter(Boolean)
    .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()));
  return names.length ? { names, match: m[0] } : null;
}

const FILLER = /\b(i|i've|have|has|had|just|spent|spend|paid|pay|paying|bought|buy|gave|give|for|on|of|the|a|an|to|at|rupees?|rs|inr|bucks|money|using|via|through|by|with upi|from|my|received|receive|got|get|earned|credited|added|add|expense|income|in|cash|card|upi|gpay|google pay|phonepe|paytm)\b/gi;

/**
 * Turns a spoken sentence ("spent 450 on petrol yesterday in cash") into new-entry form fields.
 * Returns only what it understood, plus `heard` (the original text).
 */
export function parseSpokenEntry(text, categories) {
  const patch = {};
  let rest = ` ${text} `;
  const type = TRANSFER_WORDS.test(text) ? null : CREDIT_WORDS.test(text) ? 'credit' : 'debit';
  if (type) patch.type = type;

  const amount = findAmount(text);
  if (amount) {
    patch.amount = String(amount.amount);
    rest = rest.replace(amount.match, ' ');
  }
  const date = findDate(rest);
  if (date) {
    patch.date = date.date;
    rest = rest.replace(date.match, ' ');
  }
  const split = type === 'debit' ? findSplit(rest) : null;
  if (split) rest = rest.replace(split.match, ' ');
  const method = findMethod(text);
  if (method) patch.paymentMethod = method;
  const category = findCategory(text, type ?? 'debit', categories);
  if (category) patch.category = category;

  const description = rest
    .replace(FILLER, ' ')
    .replace(/[.,!?$₹]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (description) patch.description = description.charAt(0).toUpperCase() + description.slice(1);

  if (split && amount) {
    const share = round2(amount.amount / (split.names.length + 1));
    patch.isSplit = true;
    patch.participants = split.names.map((name) => ({ name, amount: String(share) }));
  }
  return patch;
}
