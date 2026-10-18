const SAMPLE_RATE = 16000;
const MODEL_CACHED_KEY = 'dhanflow-whisper-ready';

let worker = null;
let nextId = 1;
const pending = new Map();
const progressListeners = new Set();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') return progressListeners.forEach((fn) => fn(data));
    if (data.type === 'ready') return;
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.type === 'result') {
      localStorage.setItem(MODEL_CACHED_KEY, '1');
      job.resolve(data.text);
    } else job.reject(new Error(data.message));
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'Speech model failed to load'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Whether the on-device model has been downloaded before (it is cached by the browser). */
export const isModelCached = () => localStorage.getItem(MODEL_CACHED_KEY) === '1';

/** Starts downloading/compiling the model in the background so the first transcription is quicker. */
export const warmUp = () => getWorker().postMessage({ type: 'load' });

/** Decodes any recorded audio into 16 kHz mono samples, which is what Whisper expects. */
async function toWhisperInput(blob) {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const length = Math.ceil(decoded.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return new Float32Array((await offline.startRendering()).getChannelData(0));
  } finally {
    ctx.close();
  }
}

/**
 * Speech-to-text on this device with Whisper (free, no key, works without the browser's speech service).
 * The first run downloads the model (~75 MB) once; `onProgress({ loaded, total })` reports it.
 */
export async function transcribeLocally(blob, onProgress) {
  const audio = await toWhisperInput(blob);
  const id = nextId++;
  if (onProgress) progressListeners.add(onProgress);
  try {
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
    });
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}
