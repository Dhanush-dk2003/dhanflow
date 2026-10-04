import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, BellRing, CheckCheck, CircleAlert, CircleCheck, HandCoins, Target, Trash2, TriangleAlert, X } from 'lucide-react';
import {
  useClearReadNotifications,
  useDeleteNotification,
  useNotifications,
  useReadAllNotifications,
  useReadNotification,
} from '../hooks/queries';
import { useDesktopAlerts, useNotificationPermission } from '../hooks/useBrowserNotifications';
import { TONES } from '../lib/constants';
import { maskAmounts, timeAgo } from '../lib/format';

const TYPE_ICON = { overdue: HandCoins, month_end: CircleCheck, budget: Target, info: CircleAlert };
const TYPE_ROUTE = { overdue: '/splits', month_end: '/splits', budget: '/budget' };

function SeverityIcon({ n }) {
  const Icon = n.severity === 'danger' ? TriangleAlert : TYPE_ICON[n.type] ?? CircleAlert;
  const tone = TONES[n.severity] ?? TONES.info;
  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${tone.bg} ${tone.border} ${tone.text}`}>
      <Icon size={16} />
    </div>
  );
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { data } = useNotifications();
  const readOne = useReadNotification();
  const readAll = useReadAllNotifications();
  const remove = useDeleteNotification();
  const clearRead = useClearReadNotifications();
  const { permission, request, supported } = useNotificationPermission();

  useDesktopAlerts(data?.items);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  const openItem = (n) => {
    if (!n.read) readOne.mutate(n._id);
    const route = TYPE_ROUTE[n.type];
    if (route) {
      navigate(route);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button className="btn-icon relative" onClick={() => setOpen((o) => !o)} title="Notifications">
        {unread ? <BellRing size={18} className="text-neon" /> : <Bell size={18} />}
        {unread > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="glass-solid absolute right-0 mt-2 w-[min(92vw,400px)] origin-top-right overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div>
                <p className="font-display font-semibold text-white">Notifications</p>
                <p className="text-xs text-white/40">{unread ? `${unread} unread` : 'All caught up'}</p>
              </div>
              <div className="flex gap-0.5">
                <button className="btn-icon h-8 w-8" title="Mark all as read" onClick={() => readAll.mutate()} disabled={!unread}>
                  <CheckCheck size={16} />
                </button>
                <button
                  className="btn-icon h-8 w-8"
                  title="Clear read notifications"
                  onClick={() => clearRead.mutate()}
                  disabled={!items.some((n) => n.read)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {supported && permission === 'default' && (
              <button
                onClick={request}
                className="flex w-full cursor-pointer items-center gap-3 border-b border-white/[0.06] bg-neon/[0.06] px-4 py-3 text-left text-xs text-neon hover:bg-neon/10"
              >
                <BellRing size={16} />
                Turn on desktop alerts so I can remind you even when this tab is in the background
              </button>
            )}

            <ul className="max-h-[60vh] overflow-y-auto">
              {items.length ? (
                items.map((n) => (
                  <li
                    key={n._id}
                    className={`group relative flex gap-3 border-b border-white/[0.04] px-4 py-3.5 transition hover:bg-white/[0.03] ${
                      n.read ? 'opacity-60' : ''
                    }`}
                  >
                    {!n.read && <span className="absolute top-5 left-1.5 h-1.5 w-1.5 rounded-full bg-neon" />}
                    <SeverityIcon n={n} />
                    <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => openItem(n)}>
                      <p className="text-sm font-medium text-white">{maskAmounts(n.title)}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-white/50">{maskAmounts(n.message)}</p>
                      <p className="mt-1 text-[11px] text-white/30">{timeAgo(n.createdAt)}</p>
                    </button>
                    <button
                      className="btn-icon h-7 w-7 opacity-0 group-hover:opacity-100"
                      title="Dismiss"
                      onClick={() => remove.mutate(n._id)}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-4 py-10 text-center text-sm text-white/40">
                  No notifications yet. I'll ping you about budgets, pending money and month-end summaries.
                </li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
