import * as service from '../services/transaction.service.js';
import { checkBudgetAlerts } from '../services/notification.service.js';
import { streamExcel } from '../services/export.service.js';

// Budget alerts are a side effect; a failure there must not fail the request.
const refreshBudgetAlerts = () =>
  checkBudgetAlerts().catch((err) => console.error('Budget alert check failed:', err.message));

export const list = async (req, res) => {
  res.json(await service.listTransactions(req.valid.query));
};

export const exportExcel = async (req, res) => {
  await streamExcel(req.valid.query, res);
};

export const getOne = async (req, res) => {
  res.json(await service.getTransaction(req.valid.params.id));
};

export const create = async (req, res) => {
  const txn = await service.createTransaction(req.valid.body);
  await refreshBudgetAlerts();
  res.status(201).json(txn);
};

export const update = async (req, res) => {
  const txn = await service.updateTransaction(req.valid.params.id, req.valid.body);
  await refreshBudgetAlerts();
  res.json(txn);
};

export const remove = async (req, res) => {
  await service.deleteTransaction(req.valid.params.id);
  res.status(204).end();
};
