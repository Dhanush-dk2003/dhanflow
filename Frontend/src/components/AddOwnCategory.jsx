import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useCustomCategory } from '../hooks/queries';
import { Spinner } from './ui';

/** "+ Your own" chip: names a new category, saves it to my list and hands it back. */
export default function AddOwnCategory({ type = 'debit', known = [], onAdded, label = 'Your own' }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = useCustomCategory();

  const close = () => {
    setOpen(false);
    setName('');
  };

  const add = () => {
    const value = name.trim().replace(/\s+/g, ' ');
    if (!value) return;
    const existing = known.find((c) => c.toLowerCase() === value.toLowerCase());
    if (existing) {
      onAdded(existing);
      return close();
    }
    save.mutate(
      { type, name: value },
      {
        onSuccess: () => {
          onAdded(value);
          close();
        },
      },
    );
  };

  if (!open) {
    return (
      <button type="button" className="chip border-dashed text-neon" onClick={() => setOpen(true)}>
        <Plus size={13} /> {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neon/40 bg-neon/[0.06] py-0.5 pl-3 pr-1">
      <input
        autoFocus
        maxLength={40}
        className="w-36 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
        placeholder="e.g. Gym, Pet care"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      />
      <button
        type="button"
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-neon hover:bg-neon/15 disabled:opacity-40"
        disabled={!name.trim() || save.isPending}
        onClick={add}
        aria-label="Add category"
        title="Add category"
      >
        {save.isPending ? <Spinner /> : <Check size={14} />}
      </button>
      <button
        type="button"
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-white/50 hover:bg-white/10"
        onClick={close}
        aria-label="Cancel"
        title="Cancel"
      >
        <X size={14} />
      </button>
    </span>
  );
}
