const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fileBase = (title) =>
  `DhanFlow-${(title || 'chart')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)}-${new Date().toISOString().slice(0, 10)}`;

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/**
 * A standalone SVG of the chart card: title, totals line, the drawn chart and a legend.
 * `legend` is `[{ label, value, color }]` (drawn below the chart).
 */
function buildSvg(container, { title, subtitle, legend = [], theme }) {
  const surfaces = [...container.querySelectorAll('svg.recharts-surface')];
  const chart = surfaces.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!chart) throw new Error('Chart is not ready yet');
  const light = theme === 'light';
  const colors = { bg: light ? '#ffffff' : '#0d0e16', text: light ? '#11121f' : '#ffffff', muted: light ? '#6b7280' : '#9ca3af' };
  const { width: cw, height: ch } = chart.getBoundingClientRect();
  const pad = 24;
  const head = 64;
  const cols = Math.max(1, Math.floor((cw + pad) / 240));
  const legendRows = Math.ceil(legend.length / cols);
  const width = Math.round(cw + pad * 2);
  const height = Math.round(head + ch + (legend.length ? legendRows * 22 + 16 : 0) + pad);

  const clone = chart.cloneNode(true);
  clone.setAttribute('x', pad);
  clone.setAttribute('y', head);
  clone.setAttribute('width', cw);
  clone.setAttribute('height', ch);
  clone.removeAttribute('style');
  clone.removeAttribute('class');

  const colWidth = (width - pad * 2) / cols;
  const items = legend
    .map((l, i) => {
      const x = pad + (i % cols) * colWidth;
      const y = head + ch + 16 + Math.floor(i / cols) * 22;
      return `<circle cx="${x + 5}" cy="${y + 6}" r="5" fill="${esc(l.color)}"/><text x="${x + 16}" y="${y + 10}" font-size="12" fill="${colors.text}">${esc(l.label)}${
        l.value ? `<tspan fill="${colors.muted}">  ${esc(l.value)}</tspan>` : ''
      }</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, Segoe UI, Roboto, Arial, sans-serif">
<rect width="100%" height="100%" rx="16" fill="${colors.bg}"/>
<text x="${pad}" y="${pad + 14}" font-size="16" font-weight="700" fill="${colors.text}">${esc(title)}</text>
<text x="${pad}" y="${pad + 34}" font-size="11" fill="${colors.muted}">${esc(subtitle)}</text>
${new XMLSerializer().serializeToString(clone)}
${items}
<text x="${width - pad}" y="${height - 8}" font-size="9" text-anchor="end" fill="${colors.muted}">DhanFlow</text>
</svg>`;
}

export function downloadChartSvg(container, opts) {
  return save(new Blob([buildSvg(container, opts)], { type: 'image/svg+xml' }), `${fileBase(opts.title)}.svg`);
}

export function downloadChartPng(container, opts, scale = 2) {
  const svg = buildSvg(container, opts);
  const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: w * scale, height: h * scale });
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => (blob ? resolve(save(blob, `${fileBase(opts.title)}.png`)) : reject(new Error('Could not make the image'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not make the image'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** The numbers behind the chart as CSV (raw values, so spreadsheets can sum them). */
export function downloadChartCsv(chart) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['Label', ...chart.series.map((s) => s.label)].map(cell).join(',')];
  for (const d of chart.data) lines.push([d.label, ...chart.series.map((s) => d[s.key] ?? '')].map(cell).join(','));
  return save(new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), `${fileBase(chart.title)}.csv`);
}
