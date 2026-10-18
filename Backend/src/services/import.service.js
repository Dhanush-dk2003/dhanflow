import crypto from 'node:crypto';
import { z } from 'zod';
import { Transaction } from '../models/Transaction.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { FILE_FORMATS, readUpload } from './file.reader.js';
import { describe, findReference, merchantKey, parseStatement } from './statement.parser.js';
import { parseLooseLines, parseTable } from './table.parser.js';
import { categorizeRows, categoryOptions, keywordCategory, learnCategories } from './categorize.service.js';
import { todayISO } from '../utils/dates.js';
import { chatJson, isAiEnabled } from './ai.service.js';
import { assertUsableAccounts, getDefaultAccountId } from './account.service.js';

const AI_CHUNK_CHARS = 14_000;
const AI_MAX_CHUNKS = 8;
const AI_CATEGORIZE_MAX = 200;
const DAY_MS = 86_400_000;

const aiRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  description: z.string().trim().min(1).max(200),
  amount: z.coerce.number().positive(),
  type: z.enum(['debit', 'credit']),
  reference: z.string().trim().max(40).nullish(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
});

const STATEMENT_PROMPT = `You read Indian bank statements, UPI-app histories, spreadsheets and personal expense notes, and list every transaction.
Reply with JSON only: {"transactions":[{"date":"YYYY-MM-DD or null","time":"HH:MM or null","description":"...","amount":123.45,"type":"debit|credit","reference":"UPI/UTR reference or null"}]}
Rules:
- Indian dates are day first (05/10/2026 is 5 October 2026). Use null when a row has no date; don't invent one.
- Personal expense lists are money spent (debit) unless a row says it was received or earned.
- "debit" = money left the account (withdrawal, paid, sent, DR). "credit" = money came in (deposit, received, refund, CR). If unclear, use the running balance: it falls on a debit and rises on a credit.
- description: the merchant or person, plus the purpose if the statement says it (e.g. "Swiggy", "Rajesh Kumar · rent"). Drop bank codes, VPAs and reference numbers.
- amount is the transaction amount, never the balance. Positive number.
- Skip opening/closing balances, totals, headers, footers and anything that is not a transaction. Never invent rows.
- Text lines may wrap: a transaction's details can continue on the next lines.`;

function chunkLines(lines) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length > AI_CHUNK_CHARS && current) {
      chunks.push(current);
      current = '';
    }
    current += `${line}\n`;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function aiParseStatement(lines, today) {
  const chunks = chunkLines(lines);
  if (chunks.length > AI_MAX_CHUNKS) {
    throw ApiError.badRequest('This statement is too long for the AI in one go. Import one month at a time');
  }
  const rows = [];
  for (const chunk of chunks) {
    const result = await chatJson(STATEMENT_PROMPT, chunk, { timeoutMs: 120_000 });
    for (const item of Array.isArray(result?.transactions) ? result.transactions : []) {
      const parsed = aiRowSchema.safeParse(item);
      if (!parsed.success) continue;
      const { date, time, description, amount, type, reference } = parsed.data;
      rows.push({
        date: date ?? today,
        dateMissing: !date || undefined,
        time: time ?? null,
        amount: Math.round(amount * 100) / 100,
        type,
        typeSource: 'ai',
        description: description.slice(0, 120),
        reference: reference?.replace(/\D/g, '').length >= 8 ? reference : findReference(description),
        paymentMethod: describe(description).paymentMethod,
        raw: description,
      });
    }
  }
  return rows;
}

async function aiCategorize(rows, options) {
  const pending = rows.filter((r) => r.categorySource === 'none').slice(0, AI_CATEGORIZE_MAX);
  if (!pending.length) return;
  const list = pending.map((r, i) => ({ i, type: r.type, text: r.description, details: r.raw?.slice(0, 120) }));
  const result = await chatJson(
    `You categorise Indian personal transactions. Spending categories: ${options.debit.join(', ')}. Income categories: ${options.credit.join(', ')}.
Reply with JSON only: {"categories":[{"i":0,"category":"..."}]}. Pick from the list for that row's type.
Use "Other" when you can't tell (for example a payment to an unknown person). Don't guess wildly.`,
    JSON.stringify(list),
  );
  for (const item of Array.isArray(result?.categories) ? result.categories : []) {
    const row = pending[item?.i];
    if (!row || typeof item.category !== 'string') continue;
    const category = options[row.type].find((c) => c.toLowerCase() === item.category.trim().toLowerCase());
    if (category && category !== 'Other') Object.assign(row, { category, categorySource: 'ai' });
  }
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);

/** Ids, dedupe keys and learn keys. Identical rows in one statement get #2, #3… so both survive. */
function finalizeRows(rows) {
  const seen = new Map();
  return rows.map((row, index) => {
    const base = row.reference
      ? `ref:${row.type}:${row.reference}`
      : `h:${hash(`${row.dateMissing ? 'nodate' : row.date}|${row.type}|${row.amount}|${(row.raw ?? row.description).toLowerCase().replace(/\s+/g, ' ')}`)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: index, ...row, importRef: n > 1 ? `${base}#${n}` : base, learnKey: merchantKey(row.description) };
  });
}

/**
 * Flags rows that were imported before, or that look like an entry already saved another way:
 * added by hand, or imported from a different statement (a UPI app and the bank list the same payment).
 */
async function markDuplicates(rows) {
  const refs = rows.map((r) => r.importRef);
  const imported = new Set((await Transaction.find({ importRef: { $in: refs } }, { importRef: 1 }).lean()).map((t) => t.importRef));
  const times = rows.map((r) => Date.parse(`${r.date}T00:00:00Z`));
  const others = await Transaction.find(
    {
      type: { $in: ['debit', 'credit'] },
      importRef: { $nin: refs },
      date: { $gte: new Date(Math.min(...times) - DAY_MS), $lte: new Date(Math.max(...times) + 2 * DAY_MS) },
    },
    { date: 1, amount: 1, type: 1, description: 1, category: 1 },
  ).lean();

  const used = new Set();
  for (const row of rows) row.duplicate = imported.has(row.importRef) ? 'imported' : null;
  // Same-day matches first, so a ±1 day match can't take the entry an exact one needs.
  for (const window of [0, DAY_MS]) {
    rows.forEach((row, i) => {
      if (row.duplicate) return;
      const match = others.find(
        (t) =>
          !used.has(String(t._id)) &&
          t.type === row.type &&
          Math.abs(t.amount - row.amount) < 0.005 &&
          Math.abs(Math.floor(t.date.getTime() / DAY_MS) * DAY_MS - times[i]) <= window,
      );
      if (match) {
        used.add(String(match._id));
        row.duplicate = 'possible';
        row.duplicateOf = { description: match.description || match.category, date: match.date };
      }
    });
  }
}

const cellText = (c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c == null ? '' : String(c));
const tablesToLines = (tables) => tables.flatMap((t) => t.rows.map((r) => r.map(cellText).join(' | ')));

/** Reads every table and text line of an upload with the rules. */
function readRows(upload, today) {
  const rows = [];
  const skipped = [];
  const misses = [];
  let found = null;
  let lowConfidence = false;

  for (const table of upload.tables) {
    const result = parseTable(table, { today });
    const sheet = upload.tables.length > 1 ? table.name : undefined;
    skipped.push(...result.skipped.map((s) => ({ ...s, sheet })));
    if (result.rows.length) {
      rows.push(...result.rows);
      found ??= result.found;
    } else misses.push(result);
  }
  if (upload.lines.length) {
    const statement = parseStatement(upload.lines, upload.widths);
    if (statement.rows.length) {
      rows.push(...statement.rows);
      lowConfidence = statement.lowConfidence;
    } else if (upload.format !== 'pdf' && !rows.length) {
      const loose = parseLooseLines(upload.lines, { today });
      rows.push(...loose.rows);
      skipped.push(...loose.skipped);
    }
  }
  return { rows, skipped, misses, found, lowConfidence };
}

/** Explains why nothing could be imported, naming what's missing. */
function insufficientError({ upload, misses, skipped, aiAvailable, aiError }) {
  const what = FILE_FORMATS[upload.format];
  const columns = [...new Set(misses.flatMap((m) => m.headers))].slice(0, 12);
  let message;
  if (skipped.length) {
    message = `Not enough data to create entries: found ${skipped.length} ${skipped.length === 1 ? 'row' : 'rows'}, but none has an amount.`;
  } else if (misses.some((m) => m.missing.includes('amount'))) {
    message = `Not enough data to create entries: there's no amount column in this ${what} file.${columns.length ? ` Columns found: ${columns.join(', ')}.` : ''}`;
  } else if (upload.format === 'pdf' && !upload.lines.length) {
    message = 'This PDF has no text to read (it may be a scanned image). Download the statement as a text PDF from the app or netbanking.';
  } else {
    message = `Not enough data to create entries: couldn't find any amounts in this ${what} file.`;
  }
  const aiNote = aiError ? ` AI couldn't read it either (${aiError.message}).` : '';
  return new ApiError(400, `${message} Each entry needs at least an amount; a date and what it was for help too.${aiNote}`, {
    code: 'NO_ROWS',
    aiAvailable,
    columns,
    skipped: skipped.slice(0, 5),
  });
}

/** Maps a category written in the file to one of yours, or keeps it as a new one. */
function applyFileCategories(rows, options) {
  for (const row of rows) {
    if (!row.fileCategory) continue;
    const wanted = row.fileCategory.toLowerCase();
    const category =
      options[row.type].find((c) => c.toLowerCase() === wanted) ?? keywordCategory(row.type, row.fileCategory) ?? row.fileCategory;
    Object.assign(row, { category, categorySource: 'file' });
  }
}

/** Reads a statement, spreadsheet, Word or text file and returns rows to review. Nothing is saved yet. */
export async function previewImport({ buffer, name, password, ai = 'auto' }) {
  const upload = await readUpload({ buffer, name, password });
  const today = todayISO();
  const aiOn = ai !== 'off' && isAiEnabled();
  const warnings = [];
  let { rows, skipped, misses, found, lowConfidence } = readRows(upload, today);
  let source = 'rules';
  let aiTried = false;
  let aiError = null;

  if (aiOn && (ai === 'force' || lowConfidence || !rows.length)) {
    const text = upload.lines.length ? upload.lines : tablesToLines(upload.tables);
    aiTried = text.length > 0;
    try {
      const aiRows = text.length ? await aiParseStatement(text, today) : [];
      if (aiRows.length) {
        rows = aiRows;
        skipped = [];
        lowConfidence = false;
        source = 'ai';
      }
    } catch (err) {
      if (ai === 'force') throw err;
      if (rows.length) warnings.push(`AI couldn't help this time (${err.message}). Showing what DhanFlow read by itself.`);
      else aiError = err;
    }
  }

  if (!rows.length) throw insufficientError({ upload, misses, skipped, aiAvailable: isAiEnabled() && !aiTried, aiError });

  const undated = rows.filter((r) => r.dateMissing).length;
  const allUndated = undated === rows.length;
  if (undated) {
    warnings.push(
      allUndated
        ? `The file has no dates, so every entry is set to today. Change the date on any that happened earlier.`
        : `${undated} ${undated === 1 ? 'entry has' : 'entries have'} no date and ${undated === 1 ? 'is' : 'are'} set to today. Check ${undated === 1 ? 'it' : 'them'} under "Needs a look".`,
    );
  }
  if (rows.some((r) => r.typeSource === 'assumed')) {
    warnings.push('Nothing in the file says money in or out, so entries are treated as spending. Tap "Money out" on any that were money in.');
  }

  const payFrom = [...new Set(rows.map((r) => r.payFrom).filter(Boolean))];
  if (payFrom.length > 1) {
    warnings.push(`These payments came from ${payFrom.length} bank accounts (${payFrom.join(', ')}). Untick the ones that don't belong to the account you're saving to.`);
  }

  const finalRows = finalizeRows(rows);
  const options = await categoryOptions();
  await categorizeRows(finalRows);
  applyFileCategories(finalRows, options);
  if (aiOn) {
    try {
      await aiCategorize(finalRows, options);
    } catch (err) {
      warnings.push(`AI categories skipped (${err.message}).`);
    }
  }
  await markDuplicates(finalRows);

  for (const row of finalRows) {
    // When only some rows lack a date, those are worth a look; when none have one, the warning covers it.
    row.checkDate = Boolean(row.dateMissing && !allUndated) || undefined;
    row.needsReview = row.categorySource === 'none' || row.typeSource === 'guess' || Boolean(row.checkDate);
  }

  return {
    source,
    format: upload.format,
    formatLabel: FILE_FORMATS[upload.format],
    pages: upload.pages,
    rows: finalRows,
    categories: options,
    summary: {
      ready: finalRows.length,
      skipped: skipped.length,
      skippedRows: skipped.slice(0, 50),
      found,
      verdict: skipped.length ? 'partial' : 'ready',
    },
    ai: { enabled: isAiEnabled(), provider: env.ai.label, used: aiOn, suggested: source === 'rules' && lowConfidence },
    warnings,
  };
}

/** Saves the confirmed rows to one account, skipping anything already imported. */
export async function commitImport({ account, rows }) {
  const accountId = account === undefined ? await getDefaultAccountId() : account;
  await assertUsableAccounts([accountId]);

  const refs = rows.map((r) => r.importRef).filter(Boolean);
  const existing = new Set((await Transaction.find({ importRef: { $in: refs } }, { importRef: 1 }).lean()).map((t) => t.importRef));
  const fresh = rows.filter((r) => !r.importRef || !existing.has(r.importRef));

  let imported = 0;
  if (fresh.length) {
    const docs = fresh.map(({ learnKey: _learnKey, ...r }) => ({ ...r, account: accountId, participants: [] }));
    try {
      imported = (await Transaction.insertMany(docs, { ordered: false })).length;
    } catch (err) {
      if (err.code !== 11000 && !err.writeErrors) throw err;
      imported = err.insertedDocs?.length ?? err.result?.insertedCount ?? 0;
    }
  }

  const learned = await learnCategories(fresh.map((r) => ({ ...r, learnKey: r.learnKey ?? merchantKey(r.description) })));
  return { imported, skipped: rows.length - imported, learned };
}
