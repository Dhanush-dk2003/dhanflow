import * as service from '../services/account.service.js';

export const list = async (_req, res) => {
  res.json(await service.listAccounts());
};

export const create = async (req, res) => {
  res.status(201).json(await service.createAccount(req.valid.body));
};

export const update = async (req, res) => {
  res.json(await service.updateAccount(req.valid.params.id, req.valid.body));
};

export const remove = async (req, res) => {
  await service.deleteAccount(req.valid.params.id);
  res.status(204).end();
};

export const assignUnassigned = async (req, res) => {
  res.json(await service.assignUnassigned(req.valid.params.id));
};
