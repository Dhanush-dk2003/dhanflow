import { isProd } from '../config/env.js';
import { isLockConfigured, resolveSession } from '../services/auth.service.js';
import { ApiError } from '../utils/ApiError.js';

export const SESSION_COOKIE = 'dhanflow_session';

// No maxAge: a browser-session cookie, so quitting the browser also ends the session.
const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: isProd, path: '/api' };

export function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export const setSessionCookie = (res, token) => res.cookie(SESSION_COOKIE, token, cookieOptions);
export const clearSessionCookie = (res) => res.clearCookie(SESSION_COOKIE, cookieOptions);

/** Blocks every API route while the app is locked. */
export async function requireUnlocked(req, _res, next) {
  if (!(await isLockConfigured())) return next();

  const session = await resolveSession(readSessionToken(req));
  if (!session) throw new ApiError(401, 'DhanFlow is locked', { code: 'LOCKED' });

  req.session = session;
  next();
}
