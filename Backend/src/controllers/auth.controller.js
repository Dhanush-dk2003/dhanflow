import * as auth from '../services/auth.service.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '../middleware/requireUnlocked.js';

const userAgent = (req) => req.get('user-agent') ?? '';

export const status = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await auth.getStatus(readSessionToken(req)));
};

export const setup = async (req, res) => {
  const token = await auth.setupLock(req.valid.body, userAgent(req));
  setSessionCookie(res, token);
  res.status(201).json({ ok: true });
};

export const unlock = async (req, res) => {
  const token = await auth.unlock(req.valid.body.secret, userAgent(req));
  setSessionCookie(res, token);
  res.json({ ok: true });
};

export const lock = async (req, res) => {
  await auth.lock(readSessionToken(req));
  clearSessionCookie(res);
  res.status(204).end();
};

export const update = async (req, res) => {
  res.json(await auth.updateLock(req.session, req.valid.body));
};

export const remove = async (req, res) => {
  await auth.removeLock(req.valid.body);
  clearSessionCookie(res);
  res.status(204).end();
};
