import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { isModelCached, transcribeLocally, warmUp } from '../lib/localSpeech';

const getRecognition = () => (typeof window !== 'undefined' ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : undefined);

// Set once the browser's own speech service has failed (Brave, Firefox, embedded browsers, no access to
// Google/Microsoft servers); from then on speech is turned into text on this device.
const ENGINE_KEY = 'dhanflow-speech-engine';
const MAX_SECONDS = 60;
const SILENCE_MS = 1800;
const VOICE_LEVEL = 0.012;

const canRecord = () =>
  typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

const pickMimeType = () =>
  ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';

const preferDeviceEngine = () => !getRecognition() || localStorage.getItem(ENGINE_KEY) === 'local';

/** One line describing what voice input is doing right now, or null when idle. */
export function speechStatus({ listening, interim, elapsed, onDevice, transcribing }, idleHint = 'Listening…') {
  if (transcribing) {
    const p = transcribing.progress;
    return p != null && p < 1
      ? `Downloading the speech model, ${Math.round(p * 100)}% (one time, about 75 MB)…`
      : 'Turning your speech into text on this device…';
  }
  if (!listening) return null;
  if (onDevice) return `Listening… ${elapsed}s. It stops when you pause, or tap stop.`;
  return interim || idleHint;
}

/**
 * Voice input that always works: it records the microphone, shows live words from the browser's speech
 * service when that's available, and otherwise transcribes the recording on this device with Whisper.
 * `onResult(text, recording)` gets the transcript (may be '' if it couldn't be understood) and
 * `{ blob, mimeType, duration }` of what was said.
 */
export function useSpeech({ onResult, lang = 'en-IN' } = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [onDevice, setOnDevice] = useState(false);
  const [transcribing, setTranscribing] = useState(null);
  const sessionRef = useRef(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const release = (s) => {
    clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    s.audioCtx?.close().catch(() => {});
  };

  useEffect(
    () => () => {
      const s = sessionRef.current;
      if (!s) return;
      s.cancelled = true;
      s.rec?.abort();
      if (s.recorder.state !== 'inactive') s.recorder.stop();
      release(s);
    },
    [],
  );

  const stop = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.stopping) return;
    s.stopping = true;
    s.rec?.stop();
    if (s.recorder.state !== 'inactive') s.recorder.stop();
  }, []);

  const finish = useCallback(async (s) => {
    release(s);
    sessionRef.current = null;
    setListening(false);
    setInterim('');
    setElapsed(0);
    if (s.cancelled) return;

    const blob = new Blob(s.chunks, { type: s.recorder.mimeType || 'audio/webm' });
    const recording = blob.size ? { blob, mimeType: blob.type.split(';')[0], duration: (performance.now() - s.startedAt) / 1000 } : null;
    let text = s.webText.trim();
    if (!text && !s.heardSpeech) {
      toast.message("Didn't hear anything. Try again a little closer to the mic.");
      return;
    }
    if (!text && recording) {
      setTranscribing({ progress: isModelCached() ? null : 0 });
      try {
        text = await transcribeLocally(blob, ({ loaded, total }) => setTranscribing({ progress: loaded / total }));
      } catch (err) {
        toast.error(`Couldn't turn the speech into text: ${err.message}`);
      } finally {
        setTranscribing(null);
      }
    }
    resultRef.current?.(text, recording);
  }, []);

  const finishWhenDone = useCallback((s) => s.recorderDone && s.recDone && finish(s), [finish]);

  const switchToDevice = useCallback((s) => {
    s.local = true;
    s.lastVoice = performance.now();
    setOnDevice(true);
    setInterim('');
    if (localStorage.getItem(ENGINE_KEY) !== 'local') {
      localStorage.setItem(ENGINE_KEY, 'local');
      toast.message("The browser's speech service isn't reachable here, so DhanFlow will turn your speech into text on this device.");
    }
    if (!isModelCached()) warmUp();
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    if (!canRecord()) {
      toast.error("This browser can't record audio");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      toast.error(err?.name === 'NotFoundError' ? 'No microphone found' : 'Allow microphone access in your browser to use voice input');
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
    const now = performance.now();
    const s = { stream, recorder, chunks: [], webText: '', heardSpeech: false, startedAt: now, lastVoice: now, local: true, recDone: true };
    sessionRef.current = s;
    recorder.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
    recorder.onstop = () => {
      s.recorderDone = true;
      finishWhenDone(s);
    };

    // Level meter: notices speech, and on-device mode stops by itself after a pause.
    const audioCtx = new AudioContext();
    audioCtx.resume().catch(() => {});
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    s.audioCtx = audioCtx;
    s.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const t = performance.now();
      if (Math.sqrt(sum / samples.length) > VOICE_LEVEL) {
        s.heardSpeech = true;
        s.lastVoice = t;
      }
      setElapsed(Math.floor((t - s.startedAt) / 1000));
      if ((s.local && s.heardSpeech && t - s.lastVoice > SILENCE_MS) || t - s.startedAt > MAX_SECONDS * 1000) stop();
    }, 100);

    const Recognition = getRecognition();
    if (!preferDeviceEngine()) {
      const rec = new Recognition();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = '';
      rec.onresult = (e) => {
        let heard = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else heard += r[0].transcript;
        }
        s.webText = finalText;
        setInterim((finalText + heard).trim());
      };
      rec.onerror = (e) => {
        if (e.error !== 'aborted' && e.error !== 'no-speech') switchToDevice(s);
      };
      rec.onend = () => {
        s.rec = null;
        s.recDone = true;
        if (!s.local) stop();
        finishWhenDone(s);
      };
      s.rec = rec;
      s.local = false;
      s.recDone = false;
      setOnDevice(false);
      rec.start();
    } else {
      setOnDevice(true);
      if (!isModelCached()) warmUp();
    }

    recorder.start();
    setListening(true);
  }, [lang, stop, finishWhenDone, switchToDevice]);

  const toggle = useCallback(() => (sessionRef.current ? stop() : start()), [start, stop]);

  return { supported: canRecord(), listening, interim, elapsed, onDevice, transcribing, start, stop, toggle };
}
