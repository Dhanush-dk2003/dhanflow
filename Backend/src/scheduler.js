import { runAllChecks } from './services/notification.service.js';

const INTERVAL_MS = 30 * 60 * 1000;
let timer = null;

/** Generates overdue-split, month-end and budget reminders on startup and every 30 minutes. */
export function startScheduler() {
  runAllChecks();
  timer = setInterval(runAllChecks, INTERVAL_MS);
  timer.unref();
}

export function stopScheduler() {
  clearInterval(timer);
}
