import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const isAiEnabled = () => Boolean(env.ai.baseUrl && env.ai.model && (env.ai.apiKey || env.ai.keyless));

export const aiStatus = () => ({
  enabled: isAiEnabled(),
  provider: env.ai.label,
  model: isAiEnabled() ? env.ai.model : null,
});

/** Milliseconds until the next midnight Pacific time, when daily free-tier quotas reset. */
function msUntilQuotaReset(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  );
  return Math.max(60_000, (24 * 60 - (parts.hour * 60 + parts.minute)) * 60_000);
}

/** Reads a 429 body: daily quota vs short-term rate limit, and how long until it clears. */
function parseRateLimit(body) {
  if (/PerDay/i.test(body)) return { daily: true, waitMs: msUntilQuotaReset() };
  const gemini = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (gemini) return { daily: false, waitMs: Math.ceil(Number(gemini[1])) * 1000 };
  // Groq: "Please try again in 7.66s" / "in 3m12.5s" / "in 1h2m3s"
  const other = body.match(/(?:retry|try again) in (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
  if (!other) return { daily: false, waitMs: 60_000 };
  const [, h = 0, m = 0, s] = other;
  return { daily: false, waitMs: Math.ceil(Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 };
}

function waitText(ms) {
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return `${Math.ceil(ms / 1000)} seconds`;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** model -> { until, daily }: models known to be out of quota, so they aren't retried on every request. */
const exhausted = new Map();

function rateLimitError(limits) {
  const soonest = limits.reduce((a, b) => (a.until <= b.until ? a : b));
  const waitMs = soonest.until - Date.now();
  const message = limits.every((l) => l.daily)
    ? `${env.ai.label}'s free daily limit is used up. It resets in ${waitText(waitMs)} (midnight Pacific time)`
    : `${env.ai.label}'s free limit was reached. Try again in ${waitText(waitMs)}`;
  return new ApiError(429, message, { code: 'AI_RATE_LIMIT', retryAfter: Math.ceil(waitMs / 1000) });
}

async function postCompletion(model, body, timeoutMs) {
  try {
    return await fetch(`${env.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.ai.apiKey ? { Authorization: `Bearer ${env.ai.apiKey}` } : {}),
      },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ApiError(
      502,
      err.name === 'TimeoutError' ? 'The AI took too long to answer. Try again' : `Couldn't reach ${env.ai.label}. Check your internet connection`,
    );
  }
}

/**
 * One call to an OpenAI-compatible `/chat/completions` endpoint. Returns the assistant message.
 * When the main model is out of free quota, the fallback models are tried in order.
 */
export async function chatCompletion({ messages, tools, json = false, temperature = 0.2, timeoutMs = 90_000 }) {
  if (!isAiEnabled()) {
    throw new ApiError(503, 'AI is not set up yet. Add AI_API_KEY to the backend environment', { code: 'AI_DISABLED' });
  }

  const body = {
    messages,
    temperature,
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  const models = [env.ai.model, ...env.ai.fallbackModels.filter((m) => m !== env.ai.model)];
  const limits = [];
  let failure = null;

  for (const model of models) {
    const known = exhausted.get(model);
    if (known && known.until > Date.now()) {
      limits.push(known);
      continue;
    }

    const res = await postCompletion(model, body, timeoutMs);
    if (res.ok) {
      exhausted.delete(model);
      const data = await res.json();
      const message = data.choices?.[0]?.message;
      if (!message) throw new ApiError(502, 'The AI returned an empty answer. Try again');
      return message;
    }

    const detail = await res.text().catch(() => '');
    console.error(`AI request failed (${model}, ${res.status}): ${detail.slice(0, 400)}`);
    const isFallback = model !== env.ai.model;

    if (res.status === 429) {
      const { daily, waitMs } = parseRateLimit(detail);
      const limit = { until: Date.now() + waitMs, daily };
      exhausted.set(model, limit);
      limits.push(limit);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new ApiError(502, `${env.ai.label} rejected the API key. Check AI_API_KEY`);
    if (res.status === 404 && isFallback) continue;
    if (res.status === 404) throw new ApiError(502, `The model "${model}" wasn't found. Set AI_MODEL to a current model name`);
    // Overloaded (503) or too big for this model's per-minute budget (413): the next model may still answer.
    failure = new ApiError(502, `${env.ai.label} returned an error (${res.status}). Try again`);
  }

  if (limits.length) throw rateLimitError(limits);
  throw failure ?? new ApiError(502, `None of the AI models could be used. Check AI_MODEL and AI_FALLBACK_MODELS`);
}

function parseJson(text = '') {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const block = cleaned.match(/\{[\s\S]*\}/);
    if (block) {
      try {
        return JSON.parse(block[0]);
      } catch {
        /* fall through */
      }
    }
    throw new ApiError(502, "The AI's answer couldn't be read. Try again");
  }
}

/** Asks for a JSON object and parses it. */
export async function chatJson(system, user, { timeoutMs } = {}) {
  const message = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0,
    timeoutMs,
  });
  return parseJson(message.content);
}
