const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

function buildUrl(path, params) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export const LOCKED_EVENT = 'dhanflow:locked';

export class ApiRequestError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data ?? {};
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  const res = await fetch(buildUrl(path, params), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'LOCKED') window.dispatchEvent(new Event(LOCKED_EVENT));
    throw new ApiRequestError(data?.message || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

/** Fetches a file and hands it to the browser as a download, using the server's filename. */
async function download(path, params, fallbackName) {
  const res = await fetch(buildUrl(path, params), { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && data?.code === 'LOCKED') window.dispatchEvent(new Event(LOCKED_EVENT));
    throw new ApiRequestError(data?.message || `Download failed (${res.status})`, res.status, data);
  }
  const name = res.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export const api = {
  summary: (params) => request('/summary', { params }),
  categories: () => request('/categories'),
  insights: () => request('/insights'),

  transactions: {
    list: (params) => request('/transactions', { params }),
    create: (data) => request('/transactions', { method: 'POST', body: data }),
    update: (id, data) => request(`/transactions/${id}`, { method: 'PATCH', body: data }),
    remove: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),
    exportExcel: (params) => download('/transactions/export', params, 'DhanFlow-transactions.xlsx'),
  },

  splits: {
    list: (params) => request('/splits', { params }),
    people: () => request('/splits/people'),
    pay: (transactionId, participantId, body = {}) =>
      request(`/splits/${transactionId}/participants/${participantId}/pay`, { method: 'PATCH', body }),
    unpay: (transactionId, participantId) =>
      request(`/splits/${transactionId}/participants/${participantId}/unpay`, { method: 'PATCH' }),
  },

  accounts: {
    list: () => request('/accounts'),
    create: (data) => request('/accounts', { method: 'POST', body: data }),
    update: (id, data) => request(`/accounts/${id}`, { method: 'PATCH', body: data }),
    remove: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
    assignUnassigned: (id) => request(`/accounts/${id}/assign-unassigned`, { method: 'POST' }),
  },

  budgets: {
    get: (month) => request(`/budgets/${month}`),
    save: (month, data) => request(`/budgets/${month}`, { method: 'PUT', body: data }),
    reset: (month) => request(`/budgets/${month}`, { method: 'DELETE' }),
  },

  notifications: {
    list: (params) => request('/notifications', { params }),
    read: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
    readAll: () => request('/notifications/read-all', { method: 'PATCH' }),
    remove: (id) => request(`/notifications/${id}`, { method: 'DELETE' }),
    clearRead: () => request('/notifications/read', { method: 'DELETE' }),
    check: () => request('/notifications/check', { method: 'POST' }),
  },

  settings: {
    get: () => request('/settings'),
    update: (data) => request('/settings', { method: 'PATCH', body: data }),
  },

  auth: {
    status: () => request('/auth/status'),
    setup: (data) => request('/auth/setup', { method: 'POST', body: data }),
    unlock: (secret) => request('/auth/unlock', { method: 'POST', body: { secret } }),
    lock: () => request('/auth/lock', { method: 'POST' }),
    update: (data) => request('/auth/settings', { method: 'PATCH', body: data }),
    remove: (currentSecret) => request('/auth/setup', { method: 'DELETE', body: { currentSecret } }),
  },
};
