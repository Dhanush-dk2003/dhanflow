export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const inr = (n) => inrFormat.format(Math.round(Number(n) || 0));

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const startOfDayUTC = (d) => {
  const date = new Date(d);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

export const endOfDayUTC = (d) => {
  const date = new Date(d);
  date.setUTCHours(23, 59, 59, 999);
  return date;
};

/** Builds a `{ date: { $gte, $lte } }` match fragment, or `{}` when no bounds are given. */
export const dateRangeMatch = (from, to) => {
  if (!from && !to) return {};
  const date = {};
  if (from) date.$gte = startOfDayUTC(from);
  if (to) date.$lte = endOfDayUTC(to);
  return { date };
};
