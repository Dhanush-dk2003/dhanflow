import { CategoryRule } from '../models/CategoryRule.js';
import { SPLIT_REPAYMENT_CATEGORY, TRANSFER_CATEGORY, Transaction } from '../models/Transaction.js';

export const DEFAULT_CATEGORIES = {
  debit: ['Food', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Rent', 'Entertainment', 'Health', 'Education', 'Travel', 'Subscriptions', 'Other'],
  credit: ['Salary', 'Freelance', 'Business', 'Investment', 'Gift', 'Refund', 'Other'],
};

const NOT_LEARNABLE = new Set(['Other', TRANSFER_CATEGORY, SPLIT_REPAYMENT_CATEGORY]);

// Checked in order, so specific names (Amazon Prime, JioMart) come before broad ones (Amazon, Jio).
const KEYWORDS = {
  debit: [
    ['Subscriptions', ['netflix', 'spotify', 'prime video', 'amazon prime', 'hotstar', 'jiocinema', 'jiohotstar', 'youtube premium', 'youtube', 'google one', 'icloud', 'apple services', 'chatgpt', 'openai', 'zee5', 'sonyliv', 'linkedin premium']],
    ['Groceries', ['blinkit', 'zepto', 'bigbasket', 'big basket', 'instamart', 'swiggy instamart', 'dmart', 'd mart', 'avenue supermarts', 'jiomart', 'more retail', 'reliance fresh', 'reliance smart', 'spencers', 'nature s basket', 'supermarket', 'grocery', 'groceries', 'kirana', 'provision', 'vegetables', 'fruits', 'milk', 'dairy', 'aavin', 'nandini']],
    ['Food', ['swiggy', 'zomato', 'eatsure', 'dominos', 'domino s', 'pizza hut', 'kfc', 'mcdonald', 'mcdonalds', 'burger king', 'subway', 'starbucks', 'cafe', 'coffee', 'chai', 'tea stall', 'restaurant', 'biryani', 'bakery', 'sweets', 'mess', 'canteen', 'food court', 'haldiram', 'a2b', 'adyar ananda bhavan', 'saravana bhavan']],
    ['Travel', ['makemytrip', 'make my trip', 'goibibo', 'cleartrip', 'yatra', 'ixigo', 'easemytrip', 'indigo', 'interglobe', 'air india', 'akasa', 'spicejet', 'vistara', 'oyo', 'airbnb', 'booking com', 'agoda', 'treebo', 'fabhotels']],
    ['Transport', ['uber', 'ola', 'olacabs', 'ani technologies', 'rapido', 'roppen', 'namma yatri', 'blusmart', 'metro', 'cmrl', 'bmrcl', 'dmrc', 'irctc', 'indian railways', 'redbus', 'abhibus', 'petrol', 'diesel', 'fuel', 'hpcl', 'bpcl', 'iocl', 'indian oil', 'bharat petroleum', 'hindustan petroleum', 'shell', 'fastag', 'parking', 'toll']],
    ['Entertainment', ['bookmyshow', 'book my show', 'pvr', 'inox', 'cinepolis', 'district', 'paytm insider', 'steam', 'playstation', 'xbox', 'gaming']],
    ['Health', ['pharmacy', 'pharma', 'medical', 'medicals', 'chemist', 'apollo', 'medplus', 'netmeds', 'pharmeasy', 'tata 1mg', '1mg', 'hospital', 'clinic', 'diagnostics', 'diagnostic', 'labs', 'dental', 'doctor', 'practo', 'cult fit', 'cultfit', 'gym']],
    ['Education', ['school', 'college', 'university', 'institute', 'academy', 'tuition', 'udemy', 'coursera', 'unacademy', 'byjus', 'byju s', 'physics wallah', 'exam fee', 'books', 'stationery']],
    ['Rent', ['rent', 'house rent', 'room rent', 'nobroker', 'nestaway', 'landlord', 'pg rent', 'hostel']],
    ['Bills', ['electricity', 'eb bill', 'bescom', 'tneb', 'tangedco', 'msedcl', 'bses', 'tata power', 'adani electricity', 'water bill', 'indane', 'bharat gas', 'hp gas', 'gas booking', 'broadband', 'act fibernet', 'hathway', 'airtel', 'jio', 'reliance jio', 'vodafone', 'vi prepaid', 'vi postpaid', 'bsnl', 'recharge', 'mobile bill', 'dth', 'tata play', 'sun direct', 'postpaid', 'billdesk', 'bill payment', 'insurance', 'lic', 'premium', 'emi', 'loan', 'credit card bill', 'cred club', 'cred']],
    ['Shopping', ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'tata cliq', 'snapdeal', 'decathlon', 'lifestyle', 'westside', 'zudio', 'max fashion', 'pantaloons', 'trends', 'croma', 'reliance digital', 'vijay sales', 'ikea', 'lenskart', 'boat']],
  ],
  credit: [
    ['Salary', ['salary', 'sal credit', 'payroll', 'wages', 'stipend']],
    ['Refund', ['refund', 'reversal', 'reversed', 'rev ', 'cashback', 'cash back', 'chargeback', 'failed txn']],
    ['Investment', ['interest', 'int pd', 'int paid', 'int credit', 'dividend', 'redemption', 'mutual fund', 'zerodha', 'groww', 'upstox']],
  ],
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_RX = Object.fromEntries(
  Object.entries(KEYWORDS).map(([type, list]) => [
    type,
    list.map(([category, words]) => [category, new RegExp(`\\b(${words.map((w) => escape(w.trim())).join('|')})\\b`, 'i')]),
  ]),
);

const normalise = (text) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');

export function keywordCategory(type, text) {
  const haystack = normalise(text);
  return KEYWORD_RX[type]?.find(([, rx]) => rx.test(haystack))?.[0] ?? null;
}

/**
 * Fills `category` / `categorySource` on each row:
 * learned rule → your own past entries → known merchant keywords → (AI, done by the caller) → none.
 */
export async function categorizeRows(rows) {
  const keys = [...new Set(rows.map((r) => r.learnKey).filter(Boolean))];
  const descriptions = [...new Set(rows.map((r) => r.description))];

  const [rules, history] = await Promise.all([
    keys.length ? CategoryRule.find({ key: { $in: keys } }).lean() : [],
    Transaction.aggregate([
      { $match: { type: { $in: ['debit', 'credit'] }, description: { $in: descriptions }, category: { $nin: [...NOT_LEARNABLE] } } },
      { $sort: { date: -1 } },
      { $group: { _id: { d: { $toLower: '$description' }, t: '$type' }, category: { $first: '$category' } } },
    ]).collation({ locale: 'en', strength: 2 }),
  ]);

  const ruleBy = new Map(rules.map((r) => [`${r.key}|${r.type}`, r.category]));
  const historyBy = new Map(history.map((h) => [`${h._id.d}|${h._id.t}`, h.category]));

  for (const row of rows) {
    const learned = row.learnKey && ruleBy.get(`${row.learnKey}|${row.type}`);
    const past = historyBy.get(`${row.description.toLowerCase()}|${row.type}`);
    const keyword = keywordCategory(row.type, `${row.description} ${row.raw ?? ''}`);
    if (learned) Object.assign(row, { category: learned, categorySource: 'learned' });
    else if (past) Object.assign(row, { category: past, categorySource: 'history' });
    else if (keyword) Object.assign(row, { category: keyword, categorySource: 'keyword' });
    else Object.assign(row, { category: 'Other', categorySource: 'none' });
  }
  return rows;
}

/** Remembers "this merchant/person → this category" for next time. Returns how many were saved. */
export async function learnCategories(rows) {
  const latest = new Map();
  for (const r of rows) {
    if (!r.learnKey || NOT_LEARNABLE.has(r.category)) continue;
    latest.set(`${r.learnKey}|${r.type}`, r);
  }
  if (!latest.size) return 0;
  await CategoryRule.bulkWrite(
    [...latest.values()].map((r) => ({
      updateOne: {
        filter: { key: r.learnKey, type: r.type },
        update: { $set: { category: r.category }, $inc: { uses: 1 } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return latest.size;
}

export async function categoryOptions() {
  const [debit, credit] = await Promise.all([
    Transaction.distinct('category', { type: 'debit' }),
    Transaction.distinct('category', { type: 'credit' }),
  ]);
  const clean = (list) => list.filter((c) => !NOT_LEARNABLE.has(c) || c === 'Other');
  return {
    debit: [...new Set([...DEFAULT_CATEGORIES.debit, ...clean(debit)])],
    credit: [...new Set([...DEFAULT_CATEGORIES.credit, ...clean(credit)])],
  };
}
