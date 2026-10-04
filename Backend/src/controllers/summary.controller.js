import * as service from '../services/summary.service.js';

export const summary = async (req, res) => {
  res.json(await service.getSummary(req.valid.query));
};

export const categories = async (_req, res) => {
  res.set('Cache-Control', 'private, max-age=30');
  res.json(await service.getCategories());
};
