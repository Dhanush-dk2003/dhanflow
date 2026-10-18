import { ApiError } from '../utils/ApiError.js';
import { commitImport, previewImport } from '../services/import.service.js';
import { checkBudgetAlerts } from '../services/notification.service.js';

export const preview = async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Choose a file to import');
  const { password, ai } = req.valid.body;
  res.json(await previewImport({ buffer: req.file.buffer, name: req.file.originalname, password, ai }));
};

export const commit = async (req, res) => {
  const result = await commitImport(req.valid.body);
  await checkBudgetAlerts().catch((err) => console.error('Budget alert check failed:', err.message));
  res.status(201).json(result);
};
