import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Brain, CheckCircle2, ChevronDown, FileText, FileWarning, KeyRound, RotateCcw, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { fmtDate, localISODate, money } from '../lib/format';
import { IMPORT_ACCEPT, IMPORT_EXTENSIONS } from '../lib/constants';
import { useAiStatus, useCommitImport } from '../hooks/queries';
import { AccountPicker, useAccountData } from '../components/accounts';
import { Badge, Card, PageHeader, Segmented, Spinner } from '../components/ui';

const SOURCE_BADGES = {
  learned: { label: 'Remembered', tone: 'emerald' },
  history: { label: 'From your entries', tone: 'emerald' },
  file: { label: 'From file', tone: 'emerald' },
  keyword: { label: 'Auto', tone: 'slate' },
  ai: { label: 'AI', tone: 'aqua' },
  none: { label: 'Pick a category', tone: 'amber' },
};

const COLUMN_LABELS = {
  date: 'Date',
  description: 'What',
  place: 'Where',
  amount: 'Amount',
  debit: 'Money out',
  credit: 'Money in',
  type: 'In/out',
  category: 'Category',
  method: 'Paid by',
  time: 'Time',
};

const extension = (name) => name.split('.').pop().toLowerCase();
const isPdf = (file) => file?.type === 'application/pdf' || extension(file?.name ?? '') === 'pdf';

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
const fmtTime = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const withReview = (row) => ({ ...row, needsReview: row.categorySource === 'none' || row.typeSource === 'guess' || Boolean(row.checkDate) });
const fileSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function SkippedList({ rows }) {
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {rows.map((s) => (
        <li key={`${s.line}-${s.text}`} className="flex gap-2">
          <span className="shrink-0 text-white/35">Row {s.line}</span>
          <span className="min-w-0 truncate text-white/60" title={s.text}>
            {s.text || '(empty)'}
          </span>
          <span className="shrink-0 text-amber-300/80">{s.reason}</span>
        </li>
      ))}
    </ul>
  );
}

/** Shown when the file has nothing that can become an entry, with what was missing. */
function InsufficientCard({ problem, onDismiss }) {
  return (
    <div className="mt-5 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-rose-200">
        <FileWarning size={16} /> Insufficient data
      </p>
      <p className="mt-1.5 text-rose-100/80">{problem.message}</p>
      {problem.columns?.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-white/45">Columns in the file:</span>
          {problem.columns.map((c) => (
            <Badge key={c}>{c}</Badge>
          ))}
        </div>
      )}
      {problem.skipped?.length > 0 && <SkippedList rows={problem.skipped} />}
      <p className="mt-3 text-xs text-white/50">
        Add an <span className="text-white">amount</span> column (and ideally what it was for and a date), then try again.
      </p>
      <button type="button" className="btn-ghost mt-2 -ml-2 px-2 py-1 text-xs" onClick={onDismiss}>
        Choose another file
      </button>
    </div>
  );
}

function UploadStep({ onPreview, aiStatus, initialFile }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(null);
  const [problem, setProblem] = useState(null);
  const aiOn = Boolean(aiStatus?.enabled);
  const pdf = isPdf(file);

  const pick = (f) => {
    if (!f) return null;
    if (!IMPORT_EXTENSIONS.includes(extension(f.name))) {
      toast.error(extension(f.name) === 'doc' ? 'Old .doc files can’t be read. Save it as .docx and try again' : 'Choose a PDF, Excel, CSV, Word (.docx) or text file');
      return null;
    }
    setFile(f);
    setPasswordError('');
    setProblem(null);
    return f;
  };

  const read = async (mode = aiOn && useAi ? 'auto' : 'off', target = file) => {
    if (!target) return;
    setReading(mode);
    setPasswordError('');
    setProblem(null);
    try {
      const preview = await api.imports.preview(target, { password: isPdf(target) ? password : '', ai: mode });
      onPreview({ preview, file: target, password });
    } catch (err) {
      const code = err.data?.code;
      if (code === 'PASSWORD_REQUIRED' || code === 'WRONG_PASSWORD') setPasswordError(err.message);
      else if (code === 'NO_ROWS' && err.data.aiAvailable && mode !== 'off') {
        toast.message('Nothing found by the usual rules. Asking AI to read it…');
        setReading(null);
        return read('force', target);
      } else if (code === 'NO_ROWS') setProblem({ message: err.message, columns: err.data.columns, skipped: err.data.skipped });
      else toast.error(err.message);
    } finally {
      setReading(null);
    }
  };

  // A file attached from the assistant starts reading straight away (the server skips AI if it's off).
  const started = useRef(false);
  useEffect(() => {
    if (!initialFile || started.current) return;
    started.current = true;
    const f = pick(initialFile);
    if (f) read('auto', f);
  }, [initialFile]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="p-5 sm:p-6">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragging ? 'border-neon/70 bg-neon/5' : 'border-white/15 hover:border-white/30 hover:bg-white/[0.02]'
          }`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neon">
            {file ? <FileText size={24} /> : <Upload size={24} />}
          </div>
          {file ? (
            <>
              <p className="font-display text-lg font-semibold text-white">{file.name}</p>
              <p className="text-xs text-white/45">{fileSize(file.size)} · click to choose another</p>
            </>
          ) : (
            <>
              <p className="font-display text-lg font-semibold text-white">Drop a statement or any list of expenses</p>
              <p className="text-sm text-white/45">PDF, Excel (.xlsx/.xls), CSV, Word (.docx) or text · bank statements, UPI apps, your own sheets</p>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className={`mt-5 grid gap-4 ${pdf || !file ? 'sm:grid-cols-2' : ''}`}>
          {(pdf || !file) && (
            <div>
              <label htmlFor="pdf-password" className="label">
                PDF password <span className="text-white/30">(only if it's locked)</span>
              </label>
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-white/30" />
                <input
                  id="pdf-password"
                  type="password"
                  autoComplete="off"
                  className={`input pl-10 ${passwordError ? 'border-rose-400/60' : ''}`}
                  placeholder="e.g. DOB or customer ID"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError('');
                  }}
                />
              </div>
              {passwordError && <p className="mt-1.5 text-xs text-rose-300">{passwordError}</p>}
            </div>
          )}
          <div>
            <span className="label">Smart reading</span>
            {aiOn ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#c6ff3d]" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
                <span className="text-xs text-white/60">
                  Let AI ({aiStatus.provider}) read messy files and suggest categories it doesn't know. File text is sent to {aiStatus.provider}.
                </span>
              </label>
            ) : (
              <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs text-white/45">
                AI is off. Clean statements and sheets still import fine; add a free AI key to read messy ones too.
              </p>
            )}
          </div>
        </div>

        {problem && (
          <InsufficientCard
            problem={problem}
            onDismiss={() => {
              setProblem(null);
              setFile(null);
              inputRef.current?.click();
            }}
          />
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {reading && reading !== 'off' && <p className="text-xs text-white/45">AI may take up to a minute on long files…</p>}
          <button type="button" className="btn-primary" disabled={!file || Boolean(reading)} onClick={() => read()}>
            {reading ? <Spinner className="text-black" /> : <Sparkles size={16} />} {reading ? 'Reading…' : 'Read file'}
          </button>
        </div>
      </Card>

      <Card delay={0.05} className="space-y-4 p-5 text-sm text-white/60">
        <p className="font-display text-base font-semibold text-white">How it works</p>
        {[
          ['Read', 'DhanFlow finds every entry. Each needs an amount and what it was for; the date is optional (today if missing).'],
          ['Sort', 'Categories come from your file, what you chose before, known shops, and (if on) AI. Unknown ones are marked for you.'],
          ['Check', 'Entries you already added or imported are flagged, so nothing is counted twice.'],
          ['Save', 'Nothing is saved until you press Import. Your choices are remembered for next time.'],
        ].map(([title, text], i) => (
          <div key={title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neon/15 text-xs font-bold text-neon">{i + 1}</span>
            <p>
              <span className="font-medium text-white">{title}.</span> {text}
            </p>
          </div>
        ))}
        <p className="text-xs text-white/35">
          Sheets work best with a header row like Date · Item · Where · Amount. Scanned (photo) PDFs and old .doc files can't be read.
        </p>
      </Card>
    </div>
  );
}

function RowItem({ row, categories, onChange }) {
  const badge = row.categorySource === 'you' ? null : SOURCE_BADGES[row.categorySource];
  const options = categories[row.type];
  return (
    <div
      className={`grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 rounded-2xl border px-3 py-3 transition sm:px-4 md:grid-cols-[auto_128px_1fr_150px_110px] md:items-center ${
        row.selected ? 'border-white/10 bg-white/[0.03]' : 'border-transparent opacity-50'
      } ${row.needsReview && row.selected ? 'border-amber-400/30' : ''}`}
    >
      <input
        type="checkbox"
        aria-label="Import this entry"
        className="mt-1 h-4 w-4 accent-[#c6ff3d] md:mt-0"
        checked={row.selected}
        onChange={(e) => onChange({ selected: e.target.checked })}
      />

      <div className="flex items-center gap-2 md:block">
        <input
          type="date"
          aria-label="Date"
          value={row.date}
          max={localISODate()}
          className={`w-[8.5rem] rounded-lg border bg-transparent px-1.5 py-1 text-sm text-white outline-none hover:border-white/10 focus:border-neon/50 focus:bg-white/[0.05] md:w-full ${
            row.checkDate ? 'border-amber-400/40' : 'border-transparent'
          }`}
          onChange={(e) => e.target.value && onChange({ date: e.target.value, dateMissing: false, checkDate: false })}
        />
        <p className="px-1.5 text-[11px] text-white/40">
          {row.dateMissing ? 'No date in file' : weekday(row.date)}
          {row.time && ` · ${fmtTime(row.time)}`}
        </p>
      </div>

      <div className="col-span-2 min-w-0 md:col-span-1">
        <input
          className="w-full truncate rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm text-white outline-none hover:border-white/10 focus:border-neon/50 focus:bg-white/[0.05]"
          value={row.description}
          maxLength={200}
          aria-label="Description"
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1.5">
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          {row.checkDate && <Badge tone="amber">No date, set to today</Badge>}
          {row.typeSource === 'guess' && <Badge tone="amber">In or out? Check</Badge>}
          {row.duplicate === 'imported' && <Badge tone="rose">Already imported</Badge>}
          {row.duplicate === 'possible' && (
            <Badge tone="amber">
              Looks like “{row.duplicateOf.description}” on {fmtDate(row.duplicateOf.date).slice(0, 6)}
            </Badge>
          )}
          {row.raw && row.raw !== row.description && (
            <span className="max-w-full truncate text-[11px] text-white/30" title={row.raw}>
              {row.raw}
            </span>
          )}
        </div>
      </div>

      <div className="col-span-2 flex items-center gap-2 md:col-span-1">
        <select
          className="input py-1.5 text-xs"
          value={row.category}
          aria-label="Category"
          onChange={(e) => onChange({ category: e.target.value, categorySource: 'you' })}
        >
          {!options.includes(row.category) && <option value={row.category}>{row.category}</option>}
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:flex-col md:items-end md:gap-1">
        <button
          type="button"
          title="Switch between money out and money in"
          onClick={() =>
            onChange({
              type: row.type === 'debit' ? 'credit' : 'debit',
              typeSource: 'you',
              ...(categories[row.type === 'debit' ? 'credit' : 'debit'].includes(row.category) ? {} : { category: 'Other', categorySource: 'none' }),
            })
          }
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            row.type === 'credit' ? 'border-neon/30 bg-neon/10 text-neon' : 'border-white/10 bg-white/5 text-white/60'
          }`}
        >
          {row.type === 'credit' ? 'Money in' : 'Money out'}
        </button>
        <p className={`num text-base font-semibold ${row.type === 'credit' ? 'text-neon' : 'text-white'}`}>
          {row.type === 'credit' ? '+' : '−'}
          {money(row.amount)}
        </p>
      </div>
    </div>
  );
}

/** "Enough data" verdict: how many entries are ready, which columns were used, and what was left out. */
function VerdictCard({ summary }) {
  const [showSkipped, setShowSkipped] = useState(false);
  const columns = Object.entries(summary.found ?? {}).filter(([key]) => COLUMN_LABELS[key]);
  const partial = summary.verdict === 'partial';
  return (
    <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${partial ? 'border-amber-400/20 bg-amber-500/[0.07]' : 'border-neon/20 bg-neon/[0.06]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium text-white">
          <CheckCircle2 size={16} className="text-neon" />
          Enough data: {plural(summary.ready, 'entry', 'entries')} ready
          {partial && <span className="font-normal text-amber-200">· {plural(summary.skipped, 'row')} left out</span>}
        </p>
        {partial && (
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setShowSkipped((s) => !s)}>
            {showSkipped ? 'Hide' : 'Show'} left-out rows <ChevronDown size={13} className={`transition ${showSkipped ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {columns.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-white/45">Read from:</span>
          {columns.map(([key, header]) => (
            <Badge key={key} tone="slate">
              {COLUMN_LABELS[key]}
              {header.toLowerCase() !== COLUMN_LABELS[key].toLowerCase() && <span className="text-white/35">← {header}</span>}
            </Badge>
          ))}
        </div>
      )}
      {showSkipped && <SkippedList rows={summary.skippedRows} />}
    </div>
  );
}

function ReviewStep({ data, onRestart, onReread, rereading }) {
  const navigate = useNavigate();
  const { preview } = data;
  const { active: accounts, defaultId } = useAccountData();
  const [account, setAccount] = useState(null);
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState(() => preview.rows.map((r) => ({ ...r, selected: !r.duplicate })));
  const commit = useCommitImport();
  const accountId = account ?? defaultId;

  const update = (id, patch) =>
    setRows((list) => {
      const target = list.find((r) => r.id === id);
      // Picking a category for one payee fills it in for their other unsorted entries too.
      const spread = patch.categorySource === 'you' && target.learnKey;
      return list.map((r) => {
        if (r.id === id) return withReview({ ...r, ...patch });
        if (spread && r.learnKey === target.learnKey && r.type === target.type && r.categorySource === 'none') {
          return withReview({ ...r, category: patch.category, categorySource: 'you' });
        }
        return r;
      });
    });

  const counts = useMemo(
    () => ({
      all: rows.length,
      review: rows.filter((r) => r.needsReview).length,
      dupes: rows.filter((r) => r.duplicate).length,
    }),
    [rows],
  );
  const selected = rows.filter((r) => r.selected);
  const totals = selected.reduce((t, r) => ({ ...t, [r.type]: t[r.type] + r.amount }), { debit: 0, credit: 0 });
  const visible = rows.filter((r) => (filter === 'review' ? r.needsReview : filter === 'dupes' ? r.duplicate : true));
  const allVisibleSelected = visible.length > 0 && visible.every((r) => r.selected);
  const source = [preview.formatLabel ?? 'PDF', preview.pages && plural(preview.pages, 'page')].filter(Boolean).join(', ');

  const save = async () => {
    if (!selected.length) return;
    try {
      const result = await commit.mutateAsync({
        account: accountId,
        rows: selected.map(({ date, type, amount, category, description, paymentMethod, importRef, learnKey }) => ({
          date,
          type,
          amount,
          category,
          description: description.trim(),
          paymentMethod,
          importRef,
          learnKey,
        })),
      });
      const parts = [`Imported ${plural(result.imported, 'entry', 'entries')}`];
      if (result.skipped) parts.push(`${result.skipped} were already there`);
      if (result.learned) parts.push(`I'll remember ${plural(result.learned, 'category', 'categories')} next time`);
      toast.success(parts.join(' · '));
      navigate('/transactions');
    } catch {
      /* useAppMutation already showed the error */
    }
  };

  return (
    <div className="pb-24">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost -ml-2 px-2 py-1 text-xs" onClick={onRestart}>
          <ArrowLeft size={14} /> Choose another file
        </button>
        <span className="text-xs text-white/40">
          {data.file.name} · {source} · read by {preview.source === 'ai' ? `AI (${preview.ai.provider})` : 'DhanFlow'}
        </span>
      </div>

      {preview.summary && <VerdictCard summary={preview.summary} />}

      {preview.warnings.map((w) => (
        <div key={w} className="mb-3 flex items-start gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {w}
        </div>
      ))}

      {preview.ai.enabled && preview.source === 'rules' && (
        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
            preview.ai.suggested ? 'border-aqua/30 bg-aqua/10 text-white/80' : 'border-white/10 bg-white/[0.03] text-white/55'
          }`}
        >
          <span className="flex items-center gap-2">
            <Brain size={16} className="text-aqua" />
            {preview.ai.suggested ? 'This file looks messy and some rows may be wrong. AI can usually read it better.' : 'Rows look off? Let AI read the file instead.'}
          </span>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onReread} disabled={rereading}>
            {rereading ? <Spinner /> : <Sparkles size={14} className="text-aqua" />} {rereading ? 'Reading…' : 'Read again with AI'}
          </button>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Selected', value: `${selected.length} of ${rows.length}`, raw: true },
          { label: 'Money out', value: totals.debit, color: 'text-rose-300' },
          { label: 'Money in', value: totals.credit, color: 'text-neon' },
        ].map((t) => (
          <div key={t.label} className="glass rounded-2xl px-4 py-3">
            <p className="eyebrow">{t.label}</p>
            <p className={`num mt-1 text-lg font-semibold ${t.color ?? 'text-white'}`}>{t.raw ? t.value : money(t.value)}</p>
          </div>
        ))}
      </div>

      {accounts.length > 0 && (
        <Card className="mb-4 p-4">
          <p className="label">Save to account</p>
          <AccountPicker accounts={accounts} value={accountId} onChange={setAccount} showBalance={false} />
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${counts.all}` },
            { value: 'review', label: `Needs a look ${counts.review}` },
            { value: 'dupes', label: `Already added ${counts.dupes}` },
          ]}
        />
        <label className="flex cursor-pointer items-center gap-2 text-xs text-white/55">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#c6ff3d]"
            checked={allVisibleSelected}
            onChange={(e) => {
              const ids = new Set(visible.map((r) => r.id));
              setRows((list) => list.map((r) => (ids.has(r.id) ? { ...r, selected: e.target.checked } : r)));
            }}
          />
          Select all shown
        </label>
      </div>

      {counts.review > 0 && filter === 'all' && (
        <p className="mb-3 text-xs text-white/45">
          <span className="text-amber-300">{counts.review}</span> {counts.review === 1 ? 'entry needs' : 'entries need'} a category, a date or a quick check. The
          day and time can help you remember what it was.
        </p>
      )}

      <div className="space-y-2">
        {visible.length ? (
          visible.map((row) => <RowItem key={row.id} row={row} categories={preview.categories} onChange={(patch) => update(row.id, patch)} />)
        ) : (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-white/45">
            <CheckCircle2 size={16} className="text-neon" /> Nothing here
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-4">
        <div className="glass-solid flex items-center gap-3 rounded-2xl p-2 pl-4">
          <span className="text-sm text-white/60">{plural(selected.length, 'entry', 'entries')}</span>
          <button type="button" className="btn-ghost px-3" onClick={onRestart} title="Discard and start over">
            <RotateCcw size={15} />
          </button>
          <button type="button" className="btn-primary" disabled={!selected.length || commit.isPending} onClick={save}>
            {commit.isPending ? <Spinner className="text-black" /> : <CheckCircle2 size={16} />} Import
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Import() {
  const { data: aiStatus } = useAiStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState(() => (location.state?.file ? { file: location.state.file, key: location.key } : null));
  const [data, setData] = useState(null);
  const [rereading, setRereading] = useState(false);
  const [version, setVersion] = useState(0);

  // Files attached from the assistant arrive in navigation state, even while this page is open.
  // Cleared from history afterwards so a refresh or Back doesn't read it again.
  const attached = location.state?.file;
  if (attached && incoming?.key !== location.key) {
    setIncoming({ file: attached, key: location.key });
    setData(null);
  }
  useEffect(() => {
    if (attached) navigate(location.pathname, { replace: true, state: null });
  }, [attached, location.pathname, navigate]);

  const reread = async () => {
    setRereading(true);
    try {
      const preview = await api.imports.preview(data.file, { password: data.password, ai: 'force' });
      setData({ ...data, preview });
      setVersion((v) => v + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRereading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title="Import entries from a file"
        subtitle="Bank statements, UPI exports or your own Excel, CSV, Word or text lists. You check everything before it's saved."
      />
      {data ? (
        <ReviewStep
          key={version}
          data={data}
          onRestart={() => {
            setData(null);
            setIncoming(null);
          }}
          onReread={reread}
          rereading={rereading}
        />
      ) : (
        <UploadStep key={incoming?.key ?? 'upload'} aiStatus={aiStatus} onPreview={setData} initialFile={incoming?.file} />
      )}
    </>
  );
}
