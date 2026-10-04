// Transaction dates are stored as UTC midnight of the chosen calendar day, so month
// boundaries are computed in UTC. "Today" comes from the server's local clock.

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const currentMonth = () => todayISO().slice(0, 7);

const parseMonth = (month) => month.split('-').map(Number);

export const shiftMonth = (month, delta) => {
  const [y, m] = parseMonth(month);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

export const monthBounds = (month) => {
  const [y, m] = parseMonth(month);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
};

export const daysInMonth = (month) => {
  const [y, m] = parseMonth(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const monthLabel = (month) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
