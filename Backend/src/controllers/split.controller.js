import * as service from '../services/split.service.js';
import { resolveOverdue } from '../services/notification.service.js';

export const list = async (req, res) => {
  res.json(await service.listSplits(req.valid.query));
};

export const people = async (_req, res) => {
  res.json(await service.listPeople());
};

export const pay = async (req, res) => {
  const { transactionId, participantId } = req.valid.params;
  const result = await service.markPaid(transactionId, participantId, req.valid.body);
  await resolveOverdue(participantId);
  res.json(result);
};

export const unpay = async (req, res) => {
  const { transactionId, participantId } = req.valid.params;
  res.json(await service.markUnpaid(transactionId, participantId));
};
