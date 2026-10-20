import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// OpenAI-compatible chat endpoints; every preset has a free tier (Ollama runs locally).
const AI_PRESETS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    // Free-tier quotas are per model, so a lighter model keeps working after the main one runs out.
    fallbackModels: ['gemini-3.1-flash-lite'],
    label: 'Google Gemini',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    fallbackModels: ['openai/gpt-oss-20b'],
    label: 'Groq',
  },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', label: 'Ollama (local)', keyless: true },
};

const aiProvider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const aiPreset = AI_PRESETS[aiProvider] ?? { label: aiProvider };

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/expense_tracker',
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()),
  ai: {
    provider: aiProvider,
    label: aiPreset.label,
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || aiPreset.baseUrl || '').replace(/\/+$/, ''),
    model: process.env.AI_MODEL || aiPreset.model || '',
    fallbackModels: (process.env.AI_FALLBACK_MODELS ?? (aiPreset.fallbackModels || []).join(','))
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    keyless: Boolean(aiPreset.keyless),
  },
};

export const isProd = env.nodeEnv === 'production';
