import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCategories, useDeleteTransaction, useTransactions } from '../hooks/queries';
import { useDebounce } from '../hooks/useDebounce';
import { useUI } from '../context/UIContext';
import { api } from '../lib/api';
import { DEFAULT_CATEGORIES, SPLIT_REPAYMENT, TRANSFER } from '../lib/constants';
import { fmtDate, money } from '../lib/format';
import TransactionList from '../components/TransactionList';
import { useConfirm } from '../components/ConfirmDialog';
import { AccountDot, AccountIcon, typeLabel, useAccountData } from '../components/accounts';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Segmented, Spinner } from '../components/ui';

const INITIAL_FILTERS = { type: '', category: '', from: '', to: '', split: '', sort: '-date' };
const PAGE_SIZE = 20;

function AccountFilter({ value, onChange, accounts, unassigned }) {
  if (!accounts.length) return null;
  return (
    <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
      <button className={`chip shrink-0 ${!value ? 'chip-active' : ''}`} onClick={() => onChange('')}>
        All accounts
      </button>
      {accounts.map((a) => (
        <button key={a._id} className={`chip shrink-0 ${value === a._id ? 'chip-active' : ''}`} onClick={() => onChange(a._id)}>
          <AccountDot account={a} /> {a.name}
          {a.archived && <span className="opacity-60">(archived)</span>}
        </button>
      ))}
      {unassigned && (
        <button className={`chip shrink-0 ${value === 'none' ? 'chip-active' : ''}`} onClick={() => onChange('none')}>
          No account
        </button>
      )}
    </div>
  );
}

export default function Transactions() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openTransaction } = useUI();
  const { all: accounts, byId, data: accountData } = useAccountData();

  const account = searchParams.get('account') ?? '';
  const selectedAccount = byId.get(account);
  const debouncedSearch = useDebounce(search.trim());
  const query = { ...filters, account, search: debouncedSearch };
  const { data, isLoading, isFetching, error } = useTransactions({ ...query, page, limit: PAGE_SIZE });
  const { data: categories = DEFAULT_CATEGORIES } = useCategories();
  const remove = useDeleteTransaction();

  const allCategories = [...new Set([...categories.debit, ...categories.credit, SPLIT_REPAYMENT, TRANSFER])].sort();
  const hasFilters = search || account || Object.entries(filters).some(([k, v]) => v !== INITIAL_FILTERS[k]);

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const setAccount = (id) => {
    setSearchParams(id ? { account: id } : {}, { replace: true });
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setSearch('');
    setAccount('');
  };

  const handleDelete = (txn) =>
    confirm({
      tone: 'danger',
      title: 'Delete this entry?',
      message: txn.settlementOf
        ? 'This repayment will be removed and the person will owe you again.'
        : txn.participants?.length
          ? 'Any repayments already recorded for this split will be deleted too.'
          : "Your balance will update straight away. This can't be undone.",
      detail: (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{txn.description || txn.category}</p>
            <p className="text-xs text-white/45">
              {txn.category} · {fmtDate(txn.date)}
            </p>
          </div>
          <p className={`num shrink-0 font-semibold ${txn.type === 'credit' ? 'text-neon' : 'text-white'}`}>{money(txn.amount)}</p>
        </div>
      ),
      confirmLabel: 'Delete',
      action: () => remove.mutateAsync(txn._id),
    });

  const exportExcel = async () => {
    setExporting(true);
    try {
      const name = await api.transactions.exportExcel(query);
      toast.success(`Downloaded ${name}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  };

  const { pagination, totals, items = [] } = data ?? {};

  return (
    <>
      <PageHeader eyebrow="History" title="Activity" subtitle="Every rupee in and out, searchable and exportable.">
        <button className="btn-secondary" onClick={exportExcel} disabled={exporting} title="Download the filtered list as an Excel workbook">
          {exporting ? <Spinner /> : <FileSpreadsheet size={16} className="text-emerald-300" />} {exporting ? 'Preparing…' : 'Export Excel'}
        </button>
        <button
          className="btn-primary"
          onClick={() => openTransaction(null, selectedAccount && !selectedAccount.archived ? { account: selectedAccount._id } : null)}
        >
          <Plus size={16} /> New
        </button>
      </PageHeader>

      <AccountFilter value={account} onChange={setAccount} accounts={accounts} unassigned={accountData?.unassigned} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-white/35" />
          <input
            className="input rounded-2xl py-3 pl-11"
            placeholder="Search notes, categories or people…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {isFetching && !isLoading && <Spinner className="absolute top-1/2 right-4 -translate-y-1/2" />}
        </div>
        <Segmented
          value={filters.type}
          onChange={(type) => setFilter({ type })}
          options={[
            { value: '', label: 'All' },
            { value: 'debit', label: 'Out' },
            { value: 'credit', label: 'In' },
            ...(accounts.length > 1 ? [{ value: 'transfer', label: 'Transfers' }] : []),
          ]}
        />
        <button className={`btn-secondary ${showFilters ? 'border-neon/40 text-neon' : ''}`} onClick={() => setShowFilters((s) => !s)}>
          <SlidersHorizontal size={16} /> Filters
        </button>
        {hasFilters && (
          <button className="btn-ghost" onClick={clearFilters}>
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {showFilters && (
        <Card className="mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <span className="label">Category</span>
            <select className="input" value={filters.category} onChange={(e) => setFilter({ category: e.target.value })}>
              <option value="">All categories</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Split</span>
            <select className="input" value={filters.split} onChange={(e) => setFilter({ split: e.target.value })}>
              <option value="">Any</option>
              <option value="true">Only split</option>
              <option value="false">Not split</option>
            </select>
          </div>
          <div>
            <span className="label">From</span>
            <input type="date" className="input" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
          </div>
          <div>
            <span className="label">To</span>
            <input type="date" className="input" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
          </div>
          <div>
            <span className="label">Sort</span>
            <select className="input" value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value })}>
              <option value="-date">Newest first</option>
              <option value="date">Oldest first</option>
              <option value="-amount">Highest amount</option>
              <option value="amount">Lowest amount</option>
            </select>
          </div>
        </Card>
      )}

      {error && <ErrorState error={error} />}

      {selectedAccount && (
        <Card className="mb-5 flex flex-wrap items-center gap-4 p-4">
          <AccountIcon account={selectedAccount} size="h-12 w-12" iconSize={20} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold text-white">{selectedAccount.name}</p>
            <p className="text-xs text-white/45">
              {typeLabel(selectedAccount.type)} · {selectedAccount.count} entries
              {selectedAccount.archived && ' · archived'}
            </p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Balance now</p>
            <p className={`num text-2xl font-semibold ${selectedAccount.balance < 0 ? 'text-rose-300' : 'text-white'}`}>
              {money(selectedAccount.balance)}
            </p>
          </div>
          <Link to="/accounts" className="btn-ghost px-3 py-1.5 text-xs">
            Manage
          </Link>
        </Card>
      )}

      {totals && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {[
            { label: 'Money in', value: totals.in, color: 'text-neon' },
            { label: 'Money out', value: totals.out, color: 'text-rose-300' },
            { label: 'Net', value: totals.in - totals.out, color: 'text-white' },
          ].map((t) => (
            <div key={t.label} className="glass rounded-2xl px-4 py-3">
              <p className="eyebrow">{t.label}</p>
              <p className={`num mt-1 truncate text-lg font-semibold ${t.color}`}>{money(t.value)}</p>
            </div>
          ))}
        </div>
      )}

      <Card className="p-3">
        {isLoading ? (
          <LoadingBlock />
        ) : items.length ? (
          <TransactionList
            items={items}
            accountId={selectedAccount?._id}
            onEdit={(t) => openTransaction(t)}
            onDelete={handleDelete}
          />
        ) : (
          <EmptyState
            title={hasFilters ? 'No matches' : 'No transactions yet'}
            message={hasFilters ? 'Try changing or clearing the filters.' : 'Add your first one with the + button below.'}
          />
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] px-3 pt-3 text-sm">
            <span className="text-white/45">
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} records
            </span>
            <div className="flex gap-2">
              <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={16} />
              </button>
              <button className="btn-secondary px-3 py-1.5" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
