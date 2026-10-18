import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, ChartPie, Download, LineChart as LineIcon } from 'lucide-react';
import { money, moneyCompact, moneyWhole } from '../lib/format';
import { downloadChartCsv, downloadChartPng, downloadChartSvg } from '../lib/chartExport';
import { usePalette, useUI } from '../context/UIContext';

const TIME_GROUPS = new Set(['day', 'week', 'month']);
const CHART_PICKER = [
  { id: 'bar', icon: BarChart3, label: 'Bars' },
  { id: 'area', icon: LineIcon, label: 'Trend' },
  { id: 'donut', icon: ChartPie, label: 'Donut' },
];

const valueText = (series, v) => {
  const n = Number(v ?? 0);
  if (series.format === 'count') return n.toLocaleString('en-IN');
  if (series.format === 'days') return `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${n === 1 ? 'day' : 'days'}`;
  if (series.format === 'percent') return `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  return money(v);
};
const axisText = (series) => (v) => {
  if (series.format === 'count') return v;
  if (series.format === 'days') return `${v}d`;
  if (series.format === 'percent') return `${v}%`;
  return moneyCompact(v);
};

function Tip({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-solid rounded-2xl px-3 py-2 text-xs">
      <p className="mb-1 text-white/50">{label ?? payload[0].payload?.label}</p>
      {payload.map((p) => {
        const s = series.find((x) => x.key === p.dataKey) ?? series[0];
        return (
          <p key={p.dataKey ?? p.name} className="flex items-center gap-2 text-white">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color ?? p.payload?.fill }} />
            {s.label}: <span className="num font-semibold">{valueText(s, p.value)}</span>
          </p>
        );
      })}
    </div>
  );
}

function Donut({ data, series, colors }) {
  const [active, setActive] = useState(null);
  const s = series[0];
  const total = data.reduce((n, d) => n + (d[s.key] ?? 0), 0);
  const focus = active != null ? data[active] : null;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto h-[180px] w-[180px]">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey={s.key}
              nameKey="label"
              innerRadius={58}
              outerRadius={84}
              paddingAngle={data.length > 1 ? 3 : 0}
              cornerRadius={5}
              stroke="none"
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {data.map((d, i) => (
                <Cell key={d.label} fill={colors[i % colors.length]} opacity={active == null || active === i ? 1 : 0.25} style={{ transition: 'opacity .2s' }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <p className="eyebrow truncate">{focus ? focus.label : 'Total'}</p>
          <p className="num mt-0.5 text-base font-semibold text-white">
            {s.format ? valueText(s, focus ? focus[s.key] : total) : moneyWhole(focus ? focus[s.key] : total)}
          </p>
          {focus && total > 0 && <p className="text-[11px] text-white/45">{Math.round((focus[s.key] / total) * 100)}%</p>}
        </div>
      </div>
      <ul className="space-y-0.5 text-xs">
        {data.map((d, i) => (
          <li
            key={d.label}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1 ${active === i ? 'bg-white/[0.05]' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-2 text-white/75">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="num shrink-0 font-medium text-white">{valueText(s, d[s.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DownloadMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Download chart"
        aria-label="Download chart"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:text-white/75"
      >
        <Download size={13} />
      </button>
      {open && (
        <div className="glass-solid absolute right-0 z-20 mt-1 w-40 overflow-hidden p-1 text-xs">
          {[
            ['png', 'Image (.png)'],
            ['svg', 'Vector (.svg)'],
            ['csv', 'Data (.csv)'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="block w-full rounded-lg px-3 py-1.5 text-left text-white/75 hover:bg-white/[0.06]"
              onClick={() => {
                setOpen(false);
                onPick(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Renders a chart the assistant built from real data (`show_chart`). */
export default function AskChart({ chart }) {
  const p = usePalette();
  const { theme } = useUI();
  const bodyRef = useRef(null);
  const [type, setType] = useState(chart.chart);
  const { data, series } = chart;
  const isTime = TIME_GROUPS.has(chart.groupBy);
  // Two series read best with fixed income/spent colours; single series cycle the palette per bar/slice.
  const seriesColor = (s, i) =>
    series.length > 1 ? ({ income: p.neon, paid: p.neon, spent: p.orchid, pending: p.orchid }[s.key] ?? [p.neon, p.orchid, p.aqua, p.chart[3]][i % 4]) : [p.neon, p.aqua, p.orchid][i % 3];
  // Slices only make sense for amounts that add up, not averages like "days to pay".
  const canDonut = series.length === 1 && !isTime && !series[0].aggregate;
  const shown = type === 'pie' || type === 'donut' ? (canDonut ? 'donut' : 'bar') : type;
  const horizontal = shown === 'bar' && !isTime && data.length > 5;
  const height = horizontal ? Math.max(180, data.length * 30 + 20) : 220;
  const axis = { tickLine: false, axisLine: false, fontSize: 11, stroke: p.axis };
  const legend = series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span className="text-white/60">{v}</span>} />;

  let body;
  if (shown === 'donut') body = <Donut data={data} series={series} colors={p.chart} />;
  else if (shown === 'line' || shown === 'area') {
    const Chart = shown === 'line' ? LineChart : AreaChart;
    body = (
      <div style={{ height }}>
        <ResponsiveContainer>
          <Chart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`ask-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={seriesColor(s, i)} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={seriesColor(s, i)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 6" vertical={false} stroke={p.grid} />
            <XAxis dataKey="label" {...axis} minTickGap={16} />
            <YAxis tickFormatter={axisText(series[0])} {...axis} width={56} />
            <Tooltip content={<Tip series={series} />} cursor={{ stroke: p.cursor }} />
            {legend}
            {series.map((s, i) =>
              shown === 'line' ? (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColor(s, i)} strokeWidth={2.5} dot={data.length <= 31 ? { r: 2.5 } : false} />
              ) : (
                <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColor(s, i)} strokeWidth={2.5} fill={`url(#ask-${s.key})`} />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    );
  } else {
    body = (
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 6" vertical={horizontal} horizontal={!horizontal} stroke={p.grid} />
            {horizontal ? (
              <>
                <XAxis type="number" tickFormatter={axisText(series[0])} {...axis} />
                <YAxis type="category" dataKey="label" {...axis} width={96} tickFormatter={(v) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
              </>
            ) : (
              <>
                <XAxis dataKey="label" {...axis} minTickGap={8} />
                <YAxis tickFormatter={axisText(series[0])} {...axis} width={56} />
              </>
            )}
            <Tooltip content={<Tip series={series} />} cursor={{ fill: p.track }} />
            {legend}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={seriesColor(s, i)} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} maxBarSize={36}>
                {series.length === 1 && !isTime && data.map((d, j) => <Cell key={d.label} fill={p.chart[j % p.chart.length]} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const totals = series.map((s) => `${s.label} ${valueText(s, chart.total?.[s.key])}`).join(' · ');

  const exportAs = async (format) => {
    try {
      if (format === 'csv') return toast.success(`Downloaded ${downloadChartCsv(chart)}`);
      const legendItems =
        shown === 'donut'
          ? data.map((d, i) => ({ label: d.label, value: valueText(series[0], d[series[0].key]), color: p.chart[i % p.chart.length] }))
          : series.length > 1
            ? series.map((s, i) => ({ label: s.label, color: seriesColor(s, i) }))
            : [];
      const opts = { title: chart.title, subtitle: totals, legend: legendItems, theme };
      const name = format === 'svg' ? downloadChartSvg(bodyRef.current, opts) : await downloadChartPng(bodyRef.current, opts);
      toast.success(`Downloaded ${name}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{chart.title}</p>
          <p className="num text-[11px] text-white/40">{totals}</p>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <DownloadMenu onPick={exportAs} />
          <div className="flex shrink-0 gap-0.5 rounded-xl border border-white/10 p-0.5">
            {CHART_PICKER.filter((c) => c.id !== 'donut' || canDonut).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => setType(id)}
                className={`rounded-lg p-1.5 transition ${(shown === id || (id === 'area' && shown === 'line')) ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/75'}`}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={bodyRef}>{body}</div>
    </div>
  );
}
