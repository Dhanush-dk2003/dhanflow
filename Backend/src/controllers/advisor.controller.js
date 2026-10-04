import * as budgets from '../services/budget.service.js';
import * as notifications from '../services/notification.service.js';
import * as settings from '../services/settings.service.js';
import { getInsights } from '../services/insights.service.js';
import { currentMonth } from '../utils/dates.js';

// Budgets
export const budgetStatus = async (req, res) => {
  res.json(await budgets.getBudgetStatus(req.valid.params.month));
};

export const saveBudget = async (req, res) => {
  const { month } = req.valid.params;
  await budgets.saveBudget(month, req.valid.body);
  if (month === currentMonth()) await notifications.checkBudgetAlerts(month);
  res.json(await budgets.getBudgetStatus(month));
};

export const deleteBudget = async (req, res) => {
  await budgets.deleteBudget(req.valid.params.month);
  res.status(204).end();
};

// Notifications
export const listNotifications = async (req, res) => {
  res.json(await notifications.listNotifications(req.valid.query));
};

export const readNotification = async (req, res) => {
  res.json(await notifications.markRead(req.valid.params.id));
};

export const readAllNotifications = async (_req, res) => {
  await notifications.markAllRead();
  res.status(204).end();
};

export const deleteNotification = async (req, res) => {
  await notifications.deleteNotification(req.valid.params.id);
  res.status(204).end();
};

export const clearReadNotifications = async (_req, res) => {
  await notifications.clearRead();
  res.status(204).end();
};

export const runChecks = async (_req, res) => {
  await notifications.runAllChecks();
  res.json(await notifications.listNotifications({ limit: 30 }));
};

// Insights & settings
export const insights = async (_req, res) => {
  res.json(await getInsights());
};

export const getSettings = async (_req, res) => {
  res.json(await settings.getSettings());
};

export const updateSettings = async (req, res) => {
  res.json(await settings.updateSettings(req.valid.body));
};
