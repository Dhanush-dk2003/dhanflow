import {
  AlignmentType,
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export const EXPORT_FORMATS = ['xlsx', 'csv', 'pdf', 'docx'];

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const NUMERIC = new Set(['money', 'number', 'days', 'percent']);

const fmtDay = (iso) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

/** Plain text for a cell. `rupee` is the symbol to use (the built-in PDF fonts have no ₹ glyph). */
function cellText(value, type, rupee = '₹') {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'money': {
      const n = Number(value);
      return `${n < 0 ? '-' : ''}${rupee}${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    case 'date':
      return fmtDay(value);
    case 'days':
      return `${value} ${Number(value) === 1 ? 'day' : 'days'}`;
    case 'percent':
      return `${Math.round(Number(value))}%`;
    case 'number':
      return Number(value).toLocaleString('en-IN');
    default:
      return String(value);
  }
}

const fileName = (report, format) => `DhanFlow-${report.report}-${new Date().toISOString().slice(0, 10)}.${format}`;

function toCsv(report) {
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Raw numbers and ISO dates, so spreadsheets can sort and sum them.
  const raw = (v, type) => (v === null || v === undefined ? '' : type === 'percent' ? `${v}%` : v);
  const lines = [report.columns.map((c) => escape(c.label)).join(',')];
  for (const row of report.rows) lines.push(report.columns.map((c) => escape(raw(row[c.key], c.type))).join(','));
  // BOM so Excel opens ₹ and other non-ASCII text correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

async function toXlsx(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DhanFlow';
  const sheet = workbook.addWorksheet(report.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] });
  sheet.addRow([`DhanFlow · ${report.title}`]).font = { bold: true, size: 14 };
  sheet.addRow([report.subtitle]).font = { color: { argb: 'FF6B7280' } };
  const head = sheet.addRow(report.columns.map((c) => c.label));
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11121F' } };
  });
  for (const row of report.rows) {
    sheet.addRow(
      report.columns.map((c) => {
        const v = row[c.key];
        if (v === null || v === undefined || v === '') return null;
        if (c.type === 'date') return new Date(`${v}T00:00:00Z`);
        if (c.type === 'percent') return Number(v) / 100;
        return NUMERIC.has(c.type) ? Number(v) : v;
      }),
    );
  }
  report.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.min(40, Math.max(c.label.length + 2, ...report.rows.slice(0, 200).map((r) => cellText(r[c.key], c.type).length + 2), 10));
    if (c.type === 'money') column.numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
    if (c.type === 'date') column.numFmt = 'dd-mmm-yyyy';
    if (c.type === 'percent') column.numFmt = '0%';
    if (c.type === 'days') column.numFmt = '0.# "days"';
  });
  if (report.rows.length) sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: report.columns.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function toPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: report.columns.length > 6 ? 'landscape' : 'portrait', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const texts = report.rows.map((r) => report.columns.map((c) => cellText(r[c.key], c.type, 'Rs ')));
    // Column widths follow content length, within sensible bounds.
    const want = report.columns.map((c, i) => Math.min(30, Math.max(c.label.length, ...texts.slice(0, 200).map((t) => t[i].length), 4)));
    const scale = width / want.reduce((a, b) => a + b, 0);
    const widths = want.map((w) => w * scale);
    const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const fontSize = report.columns.length > 7 ? 7.5 : 8.5;

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#11121F').text(`DhanFlow · ${report.title}`, left, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text(`${report.subtitle}  ·  exported ${fmtDay(new Date().toISOString().slice(0, 10))}`);
    doc.moveDown(0.8);

    const drawRow = (cells, { header = false, band = false } = {}) => {
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      const height = Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - 8 }))) + 8;
      if (doc.y + height > bottom()) {
        doc.addPage();
        if (!header) drawRow(report.columns.map((c) => c.label), { header: true });
      }
      const y = doc.y;
      if (header) doc.rect(left, y, width, height).fill('#11121F');
      else if (band) doc.rect(left, y, width, height).fill('#F4F5FA');
      cells.forEach((t, i) => {
        const numeric = NUMERIC.has(report.columns[i].type);
        doc.fillColor(header ? '#FFFFFF' : numeric && t.startsWith('-') ? '#BE123C' : '#11121F');
        doc.text(t, xs[i] + 4, y + 4, { width: widths[i] - 8, align: numeric ? 'right' : 'left' });
      });
      doc.x = left;
      doc.y = y + height;
    };

    drawRow(report.columns.map((c) => c.label), { header: true });
    texts.forEach((cells, i) => drawRow(cells, { band: i % 2 === 1 }));
    if (!texts.length) doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text('Nothing matches these filters.', left, doc.y + 8);
    if (report.truncated) {
      doc.moveDown().font('Helvetica').fontSize(8).fillColor('#6B7280').text(`Showing the first ${report.rows.length} of ${report.count} rows.`, left);
    }
    doc.end();
  });
}

function toDocx(report) {
  const texts = report.rows.map((r) => report.columns.map((c) => cellText(r[c.key], c.type)));
  const want = report.columns.map((c, i) => Math.min(30, Math.max(c.label.length, ...texts.slice(0, 200).map((t) => t[i].length), 4)));
  const sum = want.reduce((a, b) => a + b, 0);
  const size = report.columns.length > 7 ? 15 : 17; // half-points
  const cell = (text, i, { header = false, band = false } = {}) => {
    const numeric = NUMERIC.has(report.columns[i].type);
    const color = header ? 'FFFFFF' : text === 'Pending' ? 'B45309' : text === 'Paid' ? '15803D' : numeric && text.startsWith('-') ? 'BE123C' : '11121F';
    return new TableCell({
      width: { size: (want[i] / sum) * 100, type: WidthType.PERCENTAGE },
      shading: header ? { type: ShadingType.CLEAR, fill: '11121F' } : band ? { type: ShadingType.CLEAR, fill: 'F4F5FA' } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      children: [
        new Paragraph({
          alignment: numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: header, color, size, font: 'Calibri' })],
        }),
      ],
    });
  };
  const children = [
    new Paragraph({ children: [new TextRun({ text: `DhanFlow · ${report.title}`, bold: true, size: 30, color: '11121F', font: 'Calibri' })] }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: `${report.subtitle}  ·  exported ${fmtDay(new Date().toISOString().slice(0, 10))}`, size: 18, color: '6B7280', font: 'Calibri' })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: report.columns.map((c, i) => cell(c.label, i, { header: true })) }),
        ...texts.map((cells, r) => new TableRow({ cantSplit: true, children: cells.map((t, i) => cell(t, i, { band: r % 2 === 1 })) })),
      ],
    }),
  ];
  if (!texts.length) children.push(new Paragraph({ children: [new TextRun({ text: 'Nothing matches these filters.', color: '6B7280', size: 20 })] }));
  if (report.truncated) {
    children.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: `Showing the first ${report.rows.length} of ${report.count} rows.`, color: '6B7280', size: 16 })] }));
  }
  const landscape = report.columns.length > 6;
  const doc = new Document({
    creator: 'DhanFlow',
    title: report.title,
    sections: [
      {
        properties: { page: { size: { orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const RENDERERS = { csv: toCsv, pdf: toPdf, docx: toDocx, xlsx: toXlsx };

/** Renders a report in the requested format. Returns `{ body, type, name }`. */
export async function renderReport(report, format) {
  const body = await (RENDERERS[format] ?? toXlsx)(report);
  return { body, type: MIME[format], name: fileName(report, format) };
}
