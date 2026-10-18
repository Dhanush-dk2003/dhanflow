import { env, pipeline } from '@huggingface/transformers';

const MODEL = 'onnx-community/whisper-base.en';

env.allowLocalModels = false;

let loading = null;
const files = new Map();

function load() {
  loading ??= pipeline('automatic-speech-recognition', MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, { loaded: p.loaded, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      self.postMessage({ type: 'progress', loaded, total });
    },
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

self.onmessage = async ({ data }) => {
  try {
    const asr = await load();
    if (data.type === 'load') return self.postMessage({ type: 'ready' });
    const out = await asr(data.audio, { chunk_length_s: 30, stride_length_s: 5 });
    self.postMessage({ type: 'result', id: data.id, text: (out?.text ?? '').trim() });
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: err?.message ?? String(err) });
  }
};
