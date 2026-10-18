import { useEffect, useRef, useState } from 'react';
import { AudioLines, Pause, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { Spinner } from './ui';

const fmtSeconds = (s) => {
  const n = Math.max(0, Math.round(s || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

let activeAudio = null;

/** Plays a fresh recording (`blob`) or a saved one (`transactionId`, fetched on first play). */
function useVoicePlayback({ blob, transactionId }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(
    () => () => {
      const a = audioRef.current;
      audioRef.current = null;
      setPlaying(false);
      setTime(0);
      if (!a) return;
      a.pause();
      URL.revokeObjectURL(a.src);
    },
    [blob, transactionId],
  );

  const toggle = async () => {
    if (playing) return audioRef.current?.pause();
    if (!audioRef.current) {
      let source = blob;
      if (!source) {
        setLoading(true);
        try {
          source = await api.transactions.voice(transactionId);
        } catch (err) {
          toast.error(err.message);
          return;
        } finally {
          setLoading(false);
        }
      }
      const a = new Audio(URL.createObjectURL(source));
      a.ontimeupdate = () => setTime(a.currentTime);
      a.onplay = () => {
        if (activeAudio && activeAudio !== a) activeAudio.pause();
        activeAudio = a;
        setPlaying(true);
      };
      a.onpause = () => setPlaying(false);
      a.onended = () => {
        setPlaying(false);
        setTime(0);
      };
      audioRef.current = a;
    }
    audioRef.current.play().catch((err) => toast.error(`Can't play this recording: ${err.message}`));
  };

  return { playing, time, loading, toggle };
}

export function VoiceNotePlayer({ blob, transactionId, duration, transcript, note, onRemove }) {
  const { playing, time, loading, toggle } = useVoicePlayback({ blob, transactionId });
  const progress = duration ? Math.min(1, time / duration) : 0;
  return (
    <div className="rounded-2xl border border-orchid/25 bg-orchid/[0.05] px-3 py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-orchid/20 text-orchid transition hover:bg-orchid/30"
          aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        >
          {loading ? <Spinner /> : playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-orchid transition-[width]" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="mt-1 flex justify-between text-[11px] text-white/45">
            <span>{note ?? 'Voice note'}</span>
            <span className="num">
              {playing || time ? `${fmtSeconds(time)} / ` : ''}
              {fmtSeconds(duration)}
            </span>
          </p>
        </div>
        {onRemove && (
          <button type="button" className="btn-icon h-8 w-8 hover:text-rose-300" onClick={onRemove} title="Remove voice note" aria-label="Remove voice note">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {transcript && <p className="mt-2 text-xs italic text-white/55">“{transcript}”</p>}
    </div>
  );
}

/** Small play button for a saved voice note, for lists. */
export function VoiceNoteChip({ transactionId, duration }) {
  const { playing, loading, toggle } = useVoicePlayback({ transactionId });
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
        playing ? 'border-orchid/50 bg-orchid/20 text-orchid' : 'border-orchid/25 bg-orchid/10 text-orchid/90 hover:bg-orchid/20'
      }`}
      title={playing ? 'Pause voice note' : 'Play voice note'}
    >
      {loading ? <Spinner className="h-3 w-3" /> : playing ? <Pause size={11} /> : <AudioLines size={11} />}
      <span className="num">{fmtSeconds(duration)}</span>
    </button>
  );
}
