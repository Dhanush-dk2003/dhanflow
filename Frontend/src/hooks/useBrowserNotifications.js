import { useEffect, useState } from 'react';
import { maskAmounts } from '../lib/format';

const SEEN_KEY = 'dhanflow:notified-ids';
const supported = typeof window !== 'undefined' && 'Notification' in window;

const loadSeen = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
};

export function useNotificationPermission() {
  const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported');
  const request = async () => {
    if (!supported) return 'unsupported';
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  };
  return { permission, request, supported };
}

/** Pops a desktop notification for each unread reminder the first time it is seen. */
export function useDesktopAlerts(items) {
  useEffect(() => {
    if (!supported || Notification.permission !== 'granted' || !items) return;
    const seen = loadSeen();
    const fresh = items.filter((n) => !n.read && !seen.has(n._id));
    if (!fresh.length) return;

    for (const n of fresh.slice(0, 3)) {
      try {
        new Notification(maskAmounts(n.title), { body: maskAmounts(n.message), icon: '/favicon.svg', tag: n._id });
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    }
    for (const n of fresh) seen.add(n._id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300)));
  }, [items]);
}
