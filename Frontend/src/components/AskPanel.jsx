import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { ArrowUp, History, KeyRound, Maximize2, MessageSquare, Mic, Minimize2, Paperclip, Square, SquarePen, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { maskAmounts, timeAgo } from '../lib/format';
import { IMPORT_ACCEPT } from '../lib/constants';
import { useAiStatus } from '../hooks/queries';
import { speechStatus, useSpeech } from '../hooks/useSpeech';
import { useUI } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';
import AskAction from './AskActions';
import { Spinner } from './ui';

const STORE_KEY = 'dhanflow-ask-chats';
const WIDE_KEY = 'dhanflow-ask-wide';
const MAX_CHATS = 30;
const MAX_SENT_MESSAGES = 40;
const CHANGES_DATA = new Set(['created', 'updated', 'split', 'budget', 'account', 'settings', 'notifications']);
const PAGE_ROUTES = { home: '/', activity: '/transactions', accounts: '/accounts', collect: '/splits', budget: '/budget', import: '/import' };

const SUGGESTIONS = [
  'Add ₹250 for lunch today',
  'Ravi paid me back for dinner',
  'Chart who owes me, what they paid back and how fast',
  'Chart my spending by category this month',
  'Income vs spending for the last 6 months',
  "Export last month's expenses as PDF",
  'Show my budget vs spending as a table',
  'Remind Ravi about the money he owes',
  'What were my 5 biggest expenses this month?',
  'Switch to light mode',
];

const TOOL_LABELS = {
  get_overview: 'totals',
  find_transactions: 'entries',
  spending_over_time: 'trend',
  top_payees: 'top payees',
  list_accounts: 'accounts',
  money_owed_to_me: 'splits',
  budget_status: 'budget',
};

const loadChats = () => {
  try {
    const chats = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(chats) ? chats : [];
  } catch {
    return [];
  }
};

/** What the model sees for a turn: the reply plus the app's note of what was done (ids etc.). */
const toApiMessage = (m) => ({ role: m.role, content: (m.memo ? `${m.content}\n\n[${m.memo}]` : m.content).slice(0, 7900) });

function Inline({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Just enough markdown for chat replies: paragraphs, bullet/numbered lists, bold, headings. */
function Markdown({ text }) {
  const blocks = [];
  for (const line of text.split('\n')) {
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.type === 'list') last.items.push(bullet[1]);
      else blocks.push({ type: 'list', items: [bullet[1]] });
    } else if (heading) blocks.push({ type: 'heading', text: heading[1] });
    else if (line.trim()) blocks.push({ type: 'p', text: line.trim() });
  }
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.type === 'list' ? (
          <ul key={i} className="space-y-1 pl-1">
            {b.items.map((item, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neon" />
                <span>
                  <Inline text={item} />
                </span>
              </li>
            ))}
          </ul>
        ) : b.type === 'heading' ? (
          <p key={i} className="font-semibold text-white">
            <Inline text={b.text} />
          </p>
        ) : (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        ),
      )}
    </div>
  );
}

function SetupHelp() {
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/65">
      <p className="flex items-center gap-2 font-medium text-white">
        <KeyRound size={15} className="text-neon" /> Turn on the assistant (free)
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-xs">
        <li>
          Get a free key at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-aqua underline">
            aistudio.google.com/apikey
          </a>
        </li>
        <li>
          Add it to <span className="kbd">Backend/.env</span>: <span className="kbd">AI_API_KEY=your-key</span>
        </li>
        <li>Restart the backend (on Render: Environment → add AI_API_KEY)</li>
      </ol>
      <p className="text-xs text-white/40">Groq or a local Ollama work too. See the README.</p>
    </div>
  );
}

function ChatList({ chats, activeId, onOpen, onDelete, onNew }) {
  if (!chats.length) {
    return (
      <div className="py-10 text-center text-sm text-white/45">
        <MessageSquare size={22} className="mx-auto mb-2 text-white/25" />
        No saved chats yet.
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <button type="button" className="chip mb-2 w-full justify-center rounded-2xl py-2 text-sm" onClick={onNew}>
        <SquarePen size={14} /> New chat
      </button>
      {chats.map((c) => (
        <div key={c.id} className={`group flex items-center gap-2 rounded-2xl px-3 py-2.5 transition ${c.id === activeId ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(c.id)}>
            <p className="truncate text-sm text-white/85">{c.title}</p>
            <p className="text-[11px] text-white/35">
              {timeAgo(c.updatedAt)} · {c.messages.filter((m) => m.role === 'user').length} asked
            </p>
          </button>
          <button
            type="button"
            className="btn-icon h-8 w-8 opacity-60 group-hover:opacity-100"
            onClick={() => onDelete(c.id)}
            aria-label={`Delete chat ${c.title}`}
            title="Delete chat"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function AskPanel({ open, onClose }) {
  const { data: status, isLoading, refetch: refetchStatus } = useAiStatus();
  const { amountsHidden, setAmountsHidden, setTheme, openTransaction, setCalculatorOpen, setSettingsOpen } = useUI();
  const { configured: lockConfigured, lockNow } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [chats, setChats] = useState(loadChats);
  const [activeId, setActiveId] = useState(() => loadChats()[0]?.id ?? null);
  const [view, setView] = useState('chat');
  const [wide, setWide] = useState(() => localStorage.getItem(WIDE_KEY) === '1');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  const messages = chats.find((c) => c.id === activeId)?.messages ?? [];

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(chats));
    } catch {
      // Storage full or blocked: chats just won't survive a reload.
    }
  }, [chats]);

  useEffect(() => localStorage.setItem(WIDE_KEY, wide ? '1' : '0'), [wide]);

  // A key may have been added since the last check.
  useEffect(() => {
    if (open) refetchStatus();
  }, [open, refetchStatus]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (view === 'chat') listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy, view, activeId]);

  const updateMessages = (id, fn) =>
    setChats((cs) => {
      const chat = cs.find((c) => c.id === id);
      if (!chat) return cs;
      return [{ ...chat, messages: fn(chat.messages), updatedAt: Date.now() }, ...cs.filter((c) => c.id !== id)];
    });

  const patchAction = (id, msgIndex, actionIndex, patch, note) =>
    updateMessages(id, (ms) =>
      ms.map((m, i) =>
        i !== msgIndex
          ? m
          : {
              ...m,
              actions: m.actions.map((a, j) => (j === actionIndex ? { ...a, ...patch } : a)),
              memo: note ? [m.memo, note].filter(Boolean).join('\n') : m.memo,
            },
      ),
    );

  /** Entries as Excel use the richer Activity export (with a summary sheet); everything else uses reports. */
  const download = async ({ report = 'transactions', format = 'xlsx', params }) => {
    try {
      if (report === 'transactions' && format === 'xlsx') await api.transactions.exportExcel(params);
      else await api.reports.download(report, format, params);
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    }
  };

  /** Carries out an `app_control` action in the UI. Returns a note when it couldn't. */
  const runAppCommand = ({ command, page, prefill }) => {
    switch (command) {
      case 'dark_mode':
      case 'light_mode':
        setTheme(command === 'dark_mode' ? 'dark' : 'light');
        return null;
      case 'hide_amounts':
      case 'show_amounts':
        setAmountsHidden(command === 'hide_amounts');
        return null;
      case 'lock_app':
        if (!lockConfigured) {
          setSettingsOpen('lock-setup');
          return 'No app lock is set up yet, so I opened the setup instead.';
        }
        setTimeout(lockNow, 900);
        return null;
      case 'open_page':
        onClose();
        navigate(PAGE_ROUTES[page] ?? '/');
        return null;
      case 'open_add_form':
        onClose();
        openTransaction(null, prefill ? { ...prefill, ...(prefill.amount ? { amount: String(prefill.amount) } : {}) } : null);
        return null;
      case 'open_calculator':
        setCalculatorOpen(true);
        return null;
      case 'open_settings':
      case 'open_lock_setup':
        onClose();
        setSettingsOpen(command === 'open_lock_setup' ? 'lock-setup' : true);
        return null;
      default:
        return null;
    }
  };

  const ask = async (question) => {
    const text = question.trim();
    if (!text || busy) return;
    let id = activeId;
    if (!chats.some((c) => c.id === id)) {
      id = crypto.randomUUID();
      setChats((cs) => [{ id, title: text.slice(0, 70), messages: [], updatedAt: Date.now() }, ...cs].slice(0, MAX_CHATS));
      setActiveId(id);
    }
    const history = [...messages, { role: 'user', content: text }];
    updateMessages(id, (ms) => [...ms, { role: 'user', content: text }]);
    setInput('');
    setView('chat');
    setBusy(true);
    try {
      const sent = history.filter((m) => !m.error).slice(-MAX_SENT_MESSAGES);
      const { reply, toolsUsed, actions = [], memo } = await api.ai.chat(sent.map(toApiMessage));
      if (actions.some((a) => CHANGES_DATA.has(a.type))) queryClient.invalidateQueries();
      const ready = await Promise.all(
        actions.map(async (a) => (a.type === 'export' && (await download(a)) ? { ...a, state: 'downloaded' } : a)),
      );
      const notes = actions.filter((a) => a.type === 'app').map(runAppCommand).filter(Boolean);
      const content = [reply, ...notes].join('\n\n');
      updateMessages(id, (ms) => [...ms, { role: 'assistant', content, toolsUsed, actions: ready, memo }]);
    } catch (err) {
      updateMessages(id, (ms) => [...ms, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const act = async (msgIndex, actionIndex, choice) => {
    const id = activeId;
    const action = messages[msgIndex].actions[actionIndex];
    const ids = action.items?.map((t) => t.id).join(', ');
    const removeAll = async () => {
      for (const item of action.items) {
        await api.transactions.remove(item.id).catch((err) => {
          if (err.status !== 404) throw err;
        });
      }
    };
    try {
      if (action.type === 'created' && choice === 'undo') {
        await removeAll();
        patchAction(id, msgIndex, actionIndex, { state: 'undone' }, `User pressed Undo: deleted ${ids}`);
        toast.success('Undone');
      } else if (action.type === 'updated' && choice === 'undo') {
        await api.transactions.update(action.after.id, action.undo);
        patchAction(id, msgIndex, actionIndex, { state: 'undone' }, `User pressed Undo: id=${action.after.id} is back to how it was`);
        toast.success('Change undone');
      } else if (action.type === 'confirm_delete' && choice === 'delete') {
        await removeAll();
        patchAction(id, msgIndex, actionIndex, { state: 'deleted' }, `User confirmed: deleted ${ids}`);
        toast.success(action.items.length === 1 ? 'Entry deleted' : `${action.items.length} entries deleted`);
      } else if (action.type === 'confirm_delete' && choice === 'keep') {
        patchAction(id, msgIndex, actionIndex, { state: 'kept' }, 'User chose Keep: nothing deleted');
      } else if (action.type === 'split' && choice === 'undo') {
        for (const s of action.items) {
          if (action.mode === 'collected') await api.splits.unpay(s.transactionId, s.participantId);
          else await api.splits.pay(s.transactionId, s.participantId, s.paidAt ? { date: s.paidAt } : {});
        }
        const who = action.items.map((s) => `${s.name} ₹${s.amount} for ${s.for}`).join('; ');
        patchAction(id, msgIndex, actionIndex, { state: 'undone' }, `User pressed Undo: ${who} is ${action.mode === 'collected' ? 'unpaid again' : 'marked paid again'}`);
        toast.success('Undone');
      } else if (action.type === 'budget' && choice === 'undo') {
        if (action.undo) await api.budgets.save(action.month, action.undo);
        else await api.budgets.reset(action.month);
        patchAction(id, msgIndex, actionIndex, { state: 'undone' }, `User pressed Undo: budget for ${action.month} is back to how it was`);
        toast.success('Budget change undone');
      } else if (action.type === 'account' && choice === 'undo') {
        if (action.mode === 'created') await api.accounts.remove(action.after.id);
        else for (const { id: accountId, patch } of action.undo) await api.accounts.update(accountId, patch);
        patchAction(id, msgIndex, actionIndex, { state: 'undone' }, `User pressed Undo: ${action.mode === 'created' ? `removed account ${action.after.name}` : `account ${action.before.name} is back to how it was`}`);
        toast.success('Undone');
      } else if (action.type === 'settings' && choice === 'undo') {
        await api.settings.update(action.undo);
        patchAction(id, msgIndex, actionIndex, { state: 'undone' }, 'User pressed Undo: settings are back to how they were');
        toast.success('Settings change undone');
      } else if (action.type === 'confirm' && choice === 'cancel') {
        patchAction(id, msgIndex, actionIndex, { state: 'cancelled' }, `User chose Cancel: ${action.title} Nothing changed`);
        return;
      } else if (action.type === 'confirm' && choice === 'confirm') {
        if (action.kind === 'delete_account') await api.accounts.remove(action.id);
        else if (action.kind === 'remove_budget') await api.budgets.reset(action.month);
        else if (action.kind === 'clear_notifications') await api.notifications.clearRead();
        patchAction(id, msgIndex, actionIndex, { state: 'done' }, `User confirmed: ${action.title} Done`);
        toast.success('Done');
      } else if (action.type === 'remind' && choice === 'whatsapp') {
        window.open(`https://wa.me/?text=${encodeURIComponent(action.text)}`, '_blank', 'noopener');
        patchAction(id, msgIndex, actionIndex, { state: 'sent' });
        return;
      } else if (action.type === 'remind' && choice === 'copy') {
        await navigator.clipboard.writeText(action.text);
        toast.success(`Reminder for ${action.person} copied`);
        return;
      } else if (action.type === 'app' && choice === 'again') {
        const note = runAppCommand(action);
        if (note) toast(note);
        return;
      } else if (action.type === 'export' && choice === 'download') {
        if (await download(action)) patchAction(id, msgIndex, actionIndex, { state: 'downloaded' });
        return;
      } else if (action.type === 'table' && choice.startsWith('download:')) {
        await download({ report: action.report, format: choice.slice(9), params: action.params });
        return;
      }
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const newChat = () => {
    setActiveId(null);
    setView('chat');
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const deleteChat = (id) => {
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  };

  const speech = useSpeech({
    onResult: (text) => {
      if (!text) return;
      setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      inputRef.current?.focus();
    },
  });
  const voiceStatus = speechStatus(speech, 'Listening… speak now');

  const attach = (file) => {
    if (!file) return;
    onClose();
    navigate('/import', { state: { file } });
  };

  const enabled = status?.enabled;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] sm:bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label="Ask DhanFlow"
            className={`glass-solid fixed inset-y-0 right-0 z-50 flex w-full flex-col rounded-none border-y-0 border-r-0 transition-[max-width] duration-300 sm:inset-y-3 sm:right-3 sm:rounded-3xl sm:border ${
              wide ? 'max-w-3xl' : 'max-w-lg'
            }`}
            initial={{ x: '100%', opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.6 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          >
            <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neon to-aqua text-black">
                  <Sparkles size={17} />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="font-display font-semibold text-white">Ask DhanFlow</p>
                  <p className="truncate text-[11px] text-white/40">{enabled ? `${status.provider} · adds, edits, charts & exports` : 'AI assistant'}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {enabled && (
                  <>
                    <button type="button" className="btn-icon" onClick={newChat} title="New chat" aria-label="New chat" disabled={busy}>
                      <SquarePen size={16} />
                    </button>
                    <button
                      type="button"
                      className={`btn-icon ${view === 'history' ? 'bg-white/10 text-white' : ''}`}
                      onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
                      title="Saved chats"
                      aria-label="Saved chats"
                    >
                      <History size={16} />
                    </button>
                  </>
                )}
                <button type="button" className="btn-icon hidden sm:inline-flex" onClick={() => setWide((w) => !w)} title={wide ? 'Narrow' : 'Widen'} aria-label={wide ? 'Narrow panel' : 'Widen panel'}>
                  {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button type="button" className="btn-icon" onClick={onClose} aria-label="Close" title="Close (Esc)">
                  <X size={18} />
                </button>
              </div>
            </header>

            <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {isLoading ? (
                <div className="flex justify-center py-10">
                  <Spinner />
                </div>
              ) : !enabled ? (
                <SetupHelp />
              ) : view === 'history' ? (
                <ChatList
                  chats={chats}
                  activeId={activeId}
                  onNew={newChat}
                  onDelete={deleteChat}
                  onOpen={(id) => {
                    setActiveId(id);
                    setView('chat');
                  }}
                />
              ) : messages.length === 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-white/60">
                    Ask about your money or tell me what to do, typed or spoken (🎤): add, fix or delete entries, record split repayments, set budgets, manage
                    accounts and settings, draw charts, show tables and export Excel, CSV, PDF or Word. Attach a statement or file to import it.
                  </p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" className="chip justify-start rounded-2xl px-3.5 py-2.5 text-left text-sm" onClick={() => ask(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="flex justify-end">
                      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-neon/15 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-white">{m.content}</p>
                    </div>
                  ) : (
                    <div key={i} className="space-y-2">
                      <div
                        className={`max-w-[95%] rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm leading-relaxed ${
                          m.error ? 'border-rose-400/20 bg-rose-500/10 text-rose-200' : 'border-white/[0.08] bg-white/[0.04] text-white/80'
                        }`}
                      >
                        <Markdown text={amountsHidden ? maskAmounts(m.content) : m.content} />
                      </div>
                      {m.actions?.map((a, j) => (
                        <AskAction key={j} action={a} onAct={(choice) => act(i, j, choice)} onClose={onClose} />
                      ))}
                      {m.toolsUsed?.some((t) => TOOL_LABELS[t]) && (
                        <p className="pl-1 text-[10px] text-white/30">
                          Looked at: {m.toolsUsed.filter((t) => TOOL_LABELS[t]).map((t) => TOOL_LABELS[t]).join(', ')}
                        </p>
                      )}
                    </div>
                  ),
                )
              )}
              {busy && view === 'chat' && (
                <div className="flex items-center gap-2 text-xs text-white/45">
                  <Spinner /> Working on it…
                </div>
              )}
            </div>

            <form
              className="border-t border-white/[0.06] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
            >
              <div className="flex items-end gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 focus-within:border-neon/50">
                <button
                  type="button"
                  className="btn-icon h-9 w-9 shrink-0"
                  onClick={() => fileRef.current?.click()}
                  title="Import a file (PDF, Excel, CSV, Word, text)"
                  aria-label="Attach a file to import"
                >
                  <Paperclip size={16} />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={IMPORT_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    attach(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={voiceStatus ?? input}
                  readOnly={Boolean(voiceStatus)}
                  disabled={!enabled}
                  maxLength={2000}
                  placeholder={enabled ? 'e.g. Spent 450 on petrol yesterday' : 'Set up AI to start asking'}
                  className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-white outline-none placeholder:text-white/30 disabled:cursor-not-allowed"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      ask(input);
                    }
                  }}
                />
                {speech.supported && (
                  <button
                    type="button"
                    className={`btn-icon h-9 w-9 shrink-0 ${speech.listening ? 'animate-pulse bg-rose-500 text-white hover:bg-rose-500' : ''}`}
                    onClick={speech.toggle}
                    disabled={!enabled || Boolean(speech.transcribing)}
                    title={speech.listening ? 'Stop listening' : 'Speak instead of typing'}
                    aria-label={speech.listening ? 'Stop listening' : 'Voice input'}
                  >
                    {speech.transcribing ? <Spinner /> : speech.listening ? <Square size={14} /> : <Mic size={16} />}
                  </button>
                )}
                <button type="submit" className="btn-primary h-9 w-9 shrink-0 rounded-xl p-0" disabled={!enabled || busy || !input.trim() || Boolean(voiceStatus)} aria-label="Send">
                  <ArrowUp size={17} />
                </button>
              </div>
              <p className="mt-1.5 px-2 text-[10px] text-white/30">AI can make mistakes. Every change shows a card with Undo.</p>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
