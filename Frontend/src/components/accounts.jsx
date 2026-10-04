import { useMemo } from 'react';
import { Banknote, CircleDollarSign, CreditCard, Landmark, Wallet } from 'lucide-react';
import { useAccounts } from '../hooks/queries';
import { usePalette } from '../context/UIContext';
import { ACCOUNT_TYPES } from '../lib/constants';
import { moneyCompact } from '../lib/format';

const TYPE_ICONS = { bank: Landmark, cash: Banknote, wallet: Wallet, card: CreditCard, other: CircleDollarSign };
export const typeLabel = (type) => ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? 'Account';

export function useAccountColor(account) {
  const palette = usePalette();
  return palette.accounts[account?.color] ?? palette.accounts.lime;
}

/** Active accounts plus an id → account map (archived included, for history rows). */
export function useAccountData() {
  const query = useAccounts();
  const derived = useMemo(() => {
    const all = query.data?.accounts ?? [];
    return {
      all,
      active: all.filter((a) => !a.archived),
      byId: new Map(all.map((a) => [a._id, a])),
      defaultId: all.find((a) => a.isDefault && !a.archived)?._id ?? all.find((a) => !a.archived)?._id ?? null,
    };
  }, [query.data]);
  return { ...query, ...derived };
}

export function AccountIcon({ account, size = 'h-10 w-10', iconSize = 18 }) {
  const color = useAccountColor(account);
  const Icon = TYPE_ICONS[account?.type] ?? CircleDollarSign;
  return (
    <div
      className={`flex ${size} shrink-0 items-center justify-center rounded-2xl border`}
      style={{ color, backgroundColor: `${color}1a`, borderColor: `${color}40` }}
    >
      <Icon size={iconSize} />
    </div>
  );
}

export function AccountDot({ account, className = 'h-2 w-2' }) {
  const color = useAccountColor(account);
  return <span className={`inline-block shrink-0 rounded-full ${className}`} style={{ backgroundColor: color }} />;
}

export function AccountTag({ account }) {
  if (!account) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <AccountDot account={account} className="h-1.5 w-1.5" />
      {account.name}
    </span>
  );
}

function PickerChip({ account, active, onClick, showBalance }) {
  const color = useAccountColor(account);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`chip py-2 ${active ? 'text-white' : ''}`}
      style={active ? { borderColor: `${color}99`, backgroundColor: `${color}1f` } : undefined}
    >
      <AccountDot account={account} />
      {account.name}
      {showBalance && <span className="num text-[11px] opacity-60">{moneyCompact(account.balance)}</span>}
    </button>
  );
}

export function AccountPicker({ accounts, value, onChange, exclude, showBalance = true }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {accounts
        .filter((a) => a._id !== exclude)
        .map((a) => (
          <PickerChip key={a._id} account={a} active={value === a._id} onClick={() => onChange(a._id)} showBalance={showBalance} />
        ))}
    </div>
  );
}
