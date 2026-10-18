import { ApiError } from '../utils/ApiError.js';

const MAX_PAGES = 60;
let pdfjs;
const loadPdfjs = async () => (pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs'));

/**
 * Joins text fragments that share a baseline into one line; wide gaps (table columns) become 3 spaces.
 * Returns `{ text, width }` per line, width being the printed extent.
 */
function groupLines(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const h = Math.abs(item.transform[3]) || item.height || 8;
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, r.h * 0.45));
    if (!row) rows.push((row = { y, h, items: [] }));
    row.items.push({ x, end: x + (item.width || 0), str: item.str });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const item of row.items) {
        if (end !== null) {
          const gap = item.x - end;
          line += gap > row.h * 1.5 ? '   ' : gap > row.h * 0.12 ? ' ' : '';
        }
        line += item.str;
        end = Math.max(end ?? 0, item.end);
      }
      return { text: line.trim(), width: end - row.items[0].x };
    })
    .filter((l) => l.text);
}

/** Reads a PDF's text as visual lines, top to bottom, page by page, with each line's printed width. */
export async function extractLines(buffer, password) {
  const { getDocument, PasswordResponses } = await loadPdfjs();
  const task = getDocument({
    data: new Uint8Array(buffer),
    password: password || undefined,
    isEvalSupported: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    if (err?.name === 'PasswordException') {
      const wrong = err.code === PasswordResponses.INCORRECT_PASSWORD;
      throw new ApiError(
        400,
        wrong
          ? "That password didn't open the PDF. Banks often use your date of birth or customer ID"
          : 'This PDF is password protected. Enter its password',
        { code: wrong ? 'WRONG_PASSWORD' : 'PASSWORD_REQUIRED' },
      );
    }
    throw ApiError.badRequest("Couldn't read this file. Make sure it's a PDF statement");
  }

  try {
    if (doc.numPages > MAX_PAGES) throw ApiError.badRequest(`This PDF has ${doc.numPages} pages. Import ${MAX_PAGES} pages or fewer at a time`);
    const lines = [];
    const widths = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { items } = await page.getTextContent();
      for (const { text, width } of groupLines(items)) {
        lines.push(text);
        widths.push(width);
      }
      page.cleanup();
    }
    return { lines, widths, pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
