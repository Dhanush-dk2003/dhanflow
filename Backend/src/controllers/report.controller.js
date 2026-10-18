import { buildReport } from '../services/report.service.js';
import { renderReport } from '../services/report.export.js';

const FILE_ROW_LIMIT = 20_000;

export const report = async (req, res) => {
  const { report: name } = req.valid.params;
  const { format, ...filters } = req.valid.query;
  if (format === 'json') return res.json(await buildReport(name, filters));

  const data = await buildReport(name, filters, { limit: FILE_ROW_LIMIT });
  const file = await renderReport(data, format);
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.send(file.body);
};
