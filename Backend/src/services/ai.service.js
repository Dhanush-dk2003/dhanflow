import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const isAiEnabled = () => Boolean(env.ai.apiKey && env.ai.model);

export const aiStatus = () => ({
  enabled: isAiEnabled(),
  provider: env.ai.label,
  model: isAiEnabled() ? env.ai.model : null,
});

let client;
const groq = () => (client ??= new Groq({ apiKey: env.ai.apiKey, maxRetries: 0 }));

/** Rate-limit waits this short are retried once instead of failing the request. */
const SHORT_WAIT_MS = 5_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitText(ms) {
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return `${Math.ceil(ms / 1000)} seconds`;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

function retryAfterMs(err) {
  const headers = err.headers;
  const value = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
  const fromMessage = String(err.message).match(/try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
  const seconds = fromMessage ? Number(fromMessage[1] || 0) * 60 + Number(fromMessage[2]) : Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 60_000;
}

function toApiError(err) {
  if (err instanceof Groq.APIConnectionTimeoutError) return new ApiError(502, 'The AI took too long to answer. Try again');
  if (err instanceof Groq.APIConnectionError) return new ApiError(502, `Couldn't reach ${env.ai.label}. Check your internet connection`);
  if (!(err instanceof Groq.APIError)) return err;

  console.error(`AI request failed (${env.ai.model}, ${err.status}): ${String(err.message).slice(0, 400)}`);
  if (err.status === 429) {
    const waitMs = retryAfterMs(err);
    return new ApiError(429, `${env.ai.label}'s free limit was reached. Try again in ${waitText(waitMs)}`, {
      code: 'AI_RATE_LIMIT',
      retryAfter: Math.ceil(waitMs / 1000),
    });
  }
  if (err.status === 401 || err.status === 403) return new ApiError(502, `${env.ai.label} rejected the API key. Check GROQ_API_KEY`);
  if (err.status === 404) return new ApiError(502, `The model "${env.ai.model}" wasn't found. Set GROQ_MODEL to a current model name`);
  return new ApiError(502, `${env.ai.label} returned an error (${err.status}). Try again`);
}

/** One Groq chat completion. Returns the assistant message, token usage and the rate limits left. */
export async function chatCompletion({
  messages,
  tools,
  toolChoice = 'auto',
  json = false,
  temperature = 0.2,
  maxTokens = env.ai.maxTokens,
  timeoutMs = 90_000,
}) {
  if (!isAiEnabled()) {
    throw new ApiError(503, 'AI is not set up yet. Add GROQ_API_KEY to the backend environment', { code: 'AI_DISABLED' });
  }

  const request = {
    model: env.ai.model,
    messages,
    temperature,
    max_completion_tokens: maxTokens,
    top_p: 1,
    reasoning_effort: env.ai.reasoningEffort,
    stream: false,
    ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };

  let data;
  let response;
  for (let attempt = 0; !data; attempt++) {
    try {
      ({ data, response } = await groq().chat.completions.create(request, { timeout: timeoutMs }).withResponse());
    } catch (err) {
      const waitMs = err instanceof Groq.RateLimitError ? retryAfterMs(err) : Infinity;
      if (attempt === 0 && waitMs <= SHORT_WAIT_MS) {
        await sleep(waitMs);
        continue;
      }
      throw toApiError(err);
    }
  }

  const message = data.choices?.[0]?.message;
  if (!message) throw new ApiError(502, 'The AI returned an empty answer. Try again');
  // Groq rejects assistant messages that carry `reasoning` when they're sent back in the next turn.
  const { reasoning: _reasoning, ...rest } = message;
  return { message: rest, usage: readUsage(data.usage), limits: readLimits(response?.headers) };
}

function readUsage(u = {}) {
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

/** Groq's rate-limit headers: tokens are per minute, requests are per day. */
function readLimits(headers) {
  if (!headers?.get) return null;
  const num = (name) => {
    const v = Number(headers.get(name));
    return Number.isFinite(v) && headers.get(name) !== null ? v : null;
  };
  return {
    tokensPerMinute: num('x-ratelimit-limit-tokens'),
    tokensLeftThisMinute: num('x-ratelimit-remaining-tokens'),
    tokensResetIn: headers.get('x-ratelimit-reset-tokens'),
    requestsPerDay: num('x-ratelimit-limit-requests'),
    requestsLeftToday: num('x-ratelimit-remaining-requests'),
    requestsResetIn: headers.get('x-ratelimit-reset-requests'),
  };
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
export async function chatJson(system, user, { timeoutMs, maxTokens = 4096 } = {}) {
  const { message } = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0,
    maxTokens,
    timeoutMs,
  });
  return parseJson(message.content);
}
