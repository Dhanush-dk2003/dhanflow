import { aiStatus } from '../services/ai.service.js';
import { askAssistant } from '../services/assistant.service.js';

export const status = (_req, res) => {
  res.json(aiStatus());
};

export const chat = async (req, res) => {
  res.json(await askAssistant(req.valid.body.messages));
};
