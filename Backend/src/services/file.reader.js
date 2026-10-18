import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { ApiError } from '../utils/ApiError.js';
import { extractLines } from './pdf.service.js';

const MAX_ROWS = 5000;

export const FILE_FORMATS = {
  pdf: 'PDF',
  excel: 'Excel',
  csv: 'CSV',
  word: 'Word',
  text: 'text',
};
export const ACCEPTED_EXTENSIONS = ['pdf', 'xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv', 'txt', 'docx'];

const extOf = (name = '') => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

function detectFormat(buffer, name) {
  const ext = extOf(name);
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  if (isZip) {
    if (ext === 'docx') return 'word';
    if (['xlsx', 'xlsm', 'ods'].includes(ext)) return 'excel';
    const sample = buffer.subarray(0, 4000).toString('latin1');
    if (sample.includes('word/')) return 'word';
    return 'excel';
  }
  if (isOle) {
    if (ext === 'doc') throw ApiError.badRequest('Old Word files (.doc) can’t be read. Save it as .docx or PDF and try again');
    return 'excel';
  }
  if (ext === 'doc') throw ApiError.badRequest('Old Word files (.doc) can’t be read. Save it as .docx or PDF and try again');
  if (['xls'].includes(ext)) return 'excel'; // banks often send HTML saved as .xls
  if (['csv', 'tsv'].includes(ext)) return 'csv';
  return 'text';
}

function decodeText(buffer) {
  let text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) text = buffer.toString('latin1');
  return text.replace(/^\uFEFF/, '');
}

function guessDelimiter(text) {
  const sample = text.split(/\r?\n/).filter(Boolean).slice(0, 10);
  const score = (d) => {
    const counts = sample.map((l) => l.split(d).length - 1);
    return counts.every((c) => c === counts[0]) ? counts[0] * 2 : Math.min(...counts);
  };
  return [',', ';', '\t', '|'].reduce((best, d) => (score(d) > score(best) ? d : best), ',');
}

const cleanCell = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, ' ').trim();
    return s || null;
  }
  return v ?? null;
};

function sheetRows(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  return rows
    .slice(0, MAX_ROWS)
    .map((r) => r.map(cleanCell))
    .filter((r) => r.some((c) => c !== null));
}

function readWorkbook(data, opts) {
  let wb;
  try {
    wb = XLSX.read(data, { cellDates: true, dense: true, ...opts });
  } catch (err) {
    if (/password|encrypt/i.test(err.message)) {
      throw ApiError.badRequest('This spreadsheet is password protected. Open it, remove the password (or save a copy without one) and try again');
    }
    throw ApiError.badRequest("Couldn't read this spreadsheet. Save it as .xlsx or .csv and try again");
  }
  return wb.SheetNames.map((name) => ({ name, rows: sheetRows(wb.Sheets[name]) })).filter((s) => s.rows.length);
}

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const stripTags = (html) => decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Word: tables become rows of cells; everything else becomes text lines. */
async function readWord(buffer) {
  let html;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer }));
  } catch {
    throw ApiError.badRequest("Couldn't read this Word file. Save it as .docx or PDF and try again");
  }
  const tables = [];
  const rest = html.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(([tr]) =>
      [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => stripTags(cell) || null),
    );
    const clean = rows.filter((r) => r.some(Boolean));
    if (clean.length) tables.push({ name: `Table ${tables.length + 1}`, rows: clean.slice(0, MAX_ROWS) });
    return '\n';
  });
  const lines = rest
    .split(/<\/(?:p|h\d|li)>|\n/i)
    .map(stripTags)
    .filter(Boolean);
  return { tables, lines };
}

/**
 * Reads any supported upload into `{ format, pages?, tables: [{ name, rows }], lines, widths? }`.
 * Spreadsheets and Word tables come back as tables; PDFs, text and Word paragraphs as lines.
 */
export async function readUpload({ buffer, name, password }) {
  const format = detectFormat(buffer, name);

  if (format === 'pdf') {
    const { lines, widths, pages } = await extractLines(buffer, password);
    return { format, pages, tables: [], lines, widths };
  }
  if (format === 'excel') {
    const sample = buffer.subarray(0, 512).toString('latin1').toLowerCase();
    const isHtml = sample.includes('<html') || sample.includes('<table');
    const tables = readWorkbook(isHtml ? decodeText(buffer) : buffer, { type: isHtml ? 'string' : 'buffer', raw: isHtml });
    return { format, tables, lines: [] };
  }
  if (format === 'csv') {
    const text = decodeText(buffer);
    // raw: keep "05/10/2026" as text so Indian day-first dates aren't read as US month-first.
    const tables = readWorkbook(text, { type: 'string', raw: true, FS: guessDelimiter(text) });
    return { format, tables, lines: [] };
  }
  if (format === 'word') {
    const { tables, lines } = await readWord(buffer);
    return { format, tables, lines };
  }

  const text = decodeText(buffer);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_ROWS);
  // Pasted spreadsheets: tab- or comma-separated lines with a consistent column count.
  const tabbed = lines.filter((l) => l.includes('\t')).length;
  if (lines.length >= 2 && tabbed >= lines.length * 0.8) {
    return { format, tables: [{ name: 'Text', rows: lines.map((l) => l.split('\t').map(cleanCell)) }], lines: [] };
  }
  return { format, tables: [], lines };
}
