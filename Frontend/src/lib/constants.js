import { localISODate } from './format';

export const BRAND = {
  name: 'DhanFlow',
  owner: 'Dhanush',
  tagline: "Dhanush's money advisor",
};

export const SPLIT_REPAYMENT = 'Split Repayment';

export const DEFAULT_CATEGORIES = {
  debit: [
    'Food',
    'Groceries',
    'Transport',
    'Shopping',
    'Bills',
    'Rent',
    'Entertainment',
    'Health',
    'Education',
    'Travel',
    'Subscriptions',
    'Other',
  ],
  credit: ['Salary', 'Freelance', 'Business', 'Investment', 'Gift', 'Refund', 'Other'],
};

export const PAYMENT_METHODS = [
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank' },
  { value: 'other', label: 'Other' },
];

const ACCOUNT_SWATCHES = {
  dark: { lime: '#c6ff3d', aqua: '#22d3ee', orchid: '#a78bfa', rose: '#fb7185', amber: '#fbbf24', sky: '#60a5fa', emerald: '#34d399', orange: '#fb923c' },
  light: { lime: '#5b9a00', aqua: '#0891b2', orchid: '#7c3aed', rose: '#e11d48', amber: '#d97706', sky: '#2563eb', emerald: '#059669', orange: '#ea580c' },
};

export const PALETTES = {
  dark: {
    neon: '#c6ff3d',
    aqua: '#22d3ee',
    orchid: '#a78bfa',
    rose: '#fb7185',
    amber: '#fbbf24',
    whatsapp: '#5dea93',
    grid: 'rgba(255,255,255,0.06)',
    axis: 'rgba(255,255,255,0.4)',
    cursor: 'rgba(255,255,255,0.15)',
    track: 'rgba(255,255,255,0.07)',
    chart: ['#c6ff3d', '#22d3ee', '#a78bfa', '#fb7185', '#fbbf24', '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#2dd4bf', '#94a3b8'],
    accounts: ACCOUNT_SWATCHES.dark,
  },
  light: {
    neon: '#5b9a00',
    aqua: '#0891b2',
    orchid: '#7c3aed',
    rose: '#e11d48',
    amber: '#d97706',
    whatsapp: '#128c4a',
    grid: 'rgba(17,18,31,0.07)',
    axis: 'rgba(17,18,31,0.45)',
    cursor: 'rgba(17,18,31,0.15)',
    track: 'rgba(17,18,31,0.08)',
    chart: ['#65a30d', '#0891b2', '#7c3aed', '#e11d48', '#d97706', '#059669', '#db2777', '#2563eb', '#ea580c', '#0d9488', '#64748b'],
    accounts: ACCOUNT_SWATCHES.light,
  },
};

export const ACCOUNT_COLORS = Object.keys(ACCOUNT_SWATCHES.dark);

export const ACCOUNT_TYPES = [
  { value: 'bank', label: 'Bank' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Wallet / UPI' },
  { value: 'card', label: 'Credit card' },
  { value: 'other', label: 'Other' },
];

export const TRANSFER = 'Transfer';

export const TONES = {
  alert: { text: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-400/20', dot: 'bg-rose-400' },
  danger: { text: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-400/20', dot: 'bg-rose-400' },
  warn: { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-400/20', dot: 'bg-amber-400' },
  warning: { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-400/20', dot: 'bg-amber-400' },
  good: { text: 'text-neon', bg: 'bg-neon/10', border: 'border-neon/20', dot: 'bg-neon' },
  success: { text: 'text-neon', bg: 'bg-neon/10', border: 'border-neon/20', dot: 'bg-neon' },
  info: { text: 'text-aqua', bg: 'bg-aqua/10', border: 'border-aqua/20', dot: 'bg-aqua' },
};

function monthRange(offset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: localISODate(start), to: localISODate(end) };
}

export const PERIODS = [
  { id: 'this-month', label: 'This month', range: () => monthRange(0) },
  { id: 'last-month', label: 'Last month', range: () => monthRange(-1) },
  { id: 'last-3-months', label: '3 months', range: () => ({ from: monthRange(-2).from, to: monthRange(0).to }) },
  {
    id: 'this-year',
    label: 'This year',
    range: () => ({ from: `${new Date().getFullYear()}-01-01`, to: `${new Date().getFullYear()}-12-31` }),
  },
  { id: 'all', label: 'All time', range: () => ({}) },
];
