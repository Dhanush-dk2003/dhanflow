const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

// Privacy mode ("hide amounts"): every on-screen formatter returns a mask instead of the figure.
// The app subtree is remounted when this flips so already-rendered amounts update too.
export const AMOUNT_MASK = '₹ ••••';
let amountsHidden = false;
export const setAmountsHidden = (hidden) => {
  amountsHidden = hidden;
};

/** Always the real figure, for text that leaves the screen (WhatsApp reminders) or forms you are typing in. */
export const moneyExact = (n) => inr.format(n ?? 0);
export const money = (n) => (amountsHidden ? AMOUNT_MASK : moneyExact(n));
export const moneyWhole = (n) => (amountsHidden ? AMOUNT_MASK : inrWhole.format(Math.round(n ?? 0)));
export const moneyCompact = (n) => (amountsHidden ? '••' : inrCompact.format(n ?? 0));

/** Masks rupee amounts inside server-written text (insights, reminders). */
export const maskAmounts = (text) => (amountsHidden && text ? text.replace(/₹\s?\d+(,\d+)*(\.\d+)?/g, AMOUNT_MASK) : text);

// Dates are stored as UTC midnight of the chosen calendar day, so always render in UTC.
export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

export const fmtDayHeading = (iso) => {
  const today = localISODate();
  const yesterday = localISODate(new Date(Date.now() - 86_400_000));
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
};

export const timeAgo = (d) => {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
};

export const toInputDate = (d) => new Date(d).toISOString().slice(0, 10);

export const localISODate = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const currentMonthKey = () => localISODate().slice(0, 7);

export const shiftMonthKey = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

export const monthTitle = (month) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};
