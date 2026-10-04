import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { AuthConfig, Session } from '../models/Auth.js';
import { ApiError } from '../utils/ApiError.js';
import { getSettings } from './settings.service.js';

const scrypt = promisify(crypto.scrypt);
const ID = 'app';

const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const FREE_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;

// Short TTL so `npm run reset-lock` (a separate process) takes effect without a restart.
const CONFIG_TTL_MS = 5_000;
let configCache = { value: null, at: 0 };

async function getConfig() {
  if (Date.now() - configCache.at > CONFIG_TTL_MS) {
    configCache = { value: await AuthConfig.findById(ID).lean(), at: Date.now() };
  }
  return configCache.value;
}

const invalidateConfig = () => {
  configCache = { value: null, at: 0 };
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const label = (method) => (method === 'pattern' ? 'pattern' : 'PIN');

async function hashSecret(method, secret, salt) {
  // The method is part of the hashed input so a pattern can't be replayed as a PIN.
  const key = await scrypt(`${method}:${secret}`, salt, 64);
  return key.toString('hex');
}

async function matches(config, secret) {
  const candidate = Buffer.from(await hashSecret(config.method, secret, config.salt), 'hex');
  const stored = Buffer.from(config.hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

async function newSecretFields(method, secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { method, salt, hash: await hashSecret(method, secret, salt) };
}

const humanWait = (ms) => {
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s} seconds` : `${Math.ceil(s / 60)} minute${s > 60 ? 's' : ''}`;
};

/**
 * Checks a secret with brute-force protection: after 5 wrong tries each further miss
 * locks unlocking for 30s, 1m, 2m… up to 15 minutes. State lives in the DB, so a
 * server restart doesn't reset it.
 */
async function verifyThrottled(secret) {
  const config = await AuthConfig.findById(ID).lean();
  if (!config) throw ApiError.badRequest('App lock is not set up');

  const now = Date.now();
  const lockedFor = config.lockedUntil ? config.lockedUntil.getTime() - now : 0;
  if (lockedFor > 0) {
    throw new ApiError(429, `Too many wrong tries. Try again in ${humanWait(lockedFor)}`, {
      code: 'THROTTLED',
      retryAfter: Math.ceil(lockedFor / 1000),
    });
  }

  if (await matches(config, secret)) {
    if (config.failedAttempts || config.lockedUntil) {
      await AuthConfig.updateOne({ _id: ID }, { $set: { failedAttempts: 0, lockedUntil: null } });
    }
    return config;
  }

  const { failedAttempts } = await AuthConfig.findOneAndUpdate(
    { _id: ID },
    { $inc: { failedAttempts: 1 } },
    { returnDocument: 'after', projection: { failedAttempts: 1 } },
  );
  const over = failedAttempts - FREE_ATTEMPTS;
  if (over >= 0) {
    const wait = Math.min(BASE_LOCKOUT_MS * 2 ** over, MAX_LOCKOUT_MS);
    await AuthConfig.updateOne({ _id: ID }, { $set: { lockedUntil: new Date(now + wait) } });
    throw new ApiError(429, `Too many wrong tries. Try again in ${humanWait(wait)}`, {
      code: 'THROTTLED',
      retryAfter: Math.ceil(wait / 1000),
    });
  }
  const left = FREE_ATTEMPTS - failedAttempts;
  throw new ApiError(401, `Wrong ${label(config.method)}. ${left} ${left === 1 ? 'try' : 'tries'} left before a short lockout`, {
    code: 'BAD_SECRET',
    attemptsLeft: left,
  });
}

async function createSession(userAgent = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  await Session.create({
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_MAX_MS),
    userAgent: userAgent.slice(0, 300),
  });
  return token;
}

/** Returns the live session for a cookie token, or null if missing or expired. */
export async function resolveSession(token) {
  const config = await getConfig();
  if (!config || !token) return null;

  const session = await Session.findOne({ tokenHash: sha256(token) }).lean();
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }
  return session;
}

export async function isLockConfigured() {
  return Boolean(await getConfig());
}

export async function getStatus(token) {
  const [config, settings] = await Promise.all([getConfig(), getSettings()]);
  if (!config) return { configured: false, authenticated: true, name: settings.name };

  const fresh = await AuthConfig.findById(ID, { lockedUntil: 1 }).lean();
  const lockedFor = fresh?.lockedUntil ? Math.max(0, Math.ceil((fresh.lockedUntil.getTime() - Date.now()) / 1000)) : 0;
  return {
    configured: true,
    method: config.method,
    authenticated: Boolean(await resolveSession(token)),
    name: settings.name,
    retryAfter: lockedFor || undefined,
  };
}

export async function setupLock({ method, secret }, userAgent) {
  if (await AuthConfig.exists({ _id: ID })) throw ApiError.conflict('App lock is already set up');
  await AuthConfig.create({ _id: ID, ...(await newSecretFields(method, secret)) });
  invalidateConfig();
  await Session.deleteMany({});
  return createSession(userAgent);
}

export async function unlock(secret, userAgent) {
  await verifyThrottled(secret);
  return createSession(userAgent);
}

export async function lock(token) {
  if (token) await Session.deleteOne({ tokenHash: sha256(token) });
}

/** Changing the secret signs out every other device; the current session stays. */
export async function updateLock(currentSession, { currentSecret, method, secret }) {
  await verifyThrottled(currentSecret);
  await AuthConfig.updateOne({ _id: ID }, { $set: await newSecretFields(method, secret) });
  invalidateConfig();
  await Session.deleteMany({ _id: { $ne: currentSession._id } });
  return { configured: true, method, authenticated: true };
}

export async function removeLock({ currentSecret }) {
  await verifyThrottled(currentSecret);
  await AuthConfig.deleteOne({ _id: ID });
  await Session.deleteMany({});
  invalidateConfig();
}
