import { useEffect, useRef, useState } from 'react';

import type { SavedFile } from '../../shared/types';
import { Mic, Square } from '../components/icons';
import type { RecordInput } from './inputs';
import { smallButton, tile, zone } from './styles';

export type RecordState = 'idle' | 'starting' | 'recording' | 'saving' | 'done';

/** What `useRecording` gives a page. */
export type Recording = ReturnType<typeof useRecording>;

/** The formats asked of MediaRecorder, best first. */
const formats = ['audio/webm;codecs=opus', 'audio/mp4'];

/** Why the microphone couldn't be used, in words a person can act on. */
function micError(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return navigator.userAgent.includes('Mac')
      ? 'Offlane isn’t allowed to use the microphone. Allow it in System Settings › Privacy & Security › Microphone, then try again.'
      : 'Offlane isn’t allowed to use the microphone.';
  }
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (name === 'NotReadableError') {
    return 'The microphone is in use by another app.';
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Records from the default microphone, as it is: no echo cancelling, noise
 * suppression or volume levelling (Clean Up Audio does that, if wanted).
 * On stop, the recording is saved by the main process and `file` is set;
 * a tool then runs on it like a dropped file. Leaving the page throws away a
 * recording in progress. `meter` is a bar whose width follows the input
 * level, drawn without re-rendering the page.
 */
export function useRecording() {
  const [state, setState] = useState<RecordState>('idle');
  const [file, setFile] = useState<SavedFile | null>(null);
  const [error, setError] = useState('');
  const meter = useRef<HTMLSpanElement>(null);
  const live = useRef<{
    stream: MediaStream;
    recorder: MediaRecorder;
    audio: AudioContext;
    frame: number;
  } | null>(null);
  const seconds = useStopwatch(state === 'recording');

  /** Lets go of the microphone and stops the meter. */
  const release = () => {
    const current = live.current;
    if (!current) return;
    live.current = null;
    cancelAnimationFrame(current.frame);
    for (const track of current.stream.getTracks()) track.stop();
    void current.audio.close();
    if (meter.current) meter.current.style.transform = 'scaleX(0)';
  };

  // Leaving the page: what was recorded is thrown away.
  useEffect(
    () => () => {
      const current = live.current;
      if (!current) return;
      current.recorder.onstop = null;
      if (current.recorder.state !== 'inactive') current.recorder.stop();
      release();
    },
    [],
  );

  const start = async () => {
    if (state === 'starting' || state === 'recording') return;
    setError('');
    setFile(null);
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const mimeType = formats.find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, {
        ...(mimeType && { mimeType }),
        audioBitsPerSecond: 256_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        release();
        setState('saving');
        try {
          const type = recorder.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type });
          setFile(
            await window.tools.saveRecording(await blob.arrayBuffer(), type),
          );
          setState('done');
        } catch (saveError) {
          setError(micError(saveError));
          setState('idle');
        }
      };

      // The level: the loudest sample of each frame.
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const current = { stream, recorder, audio, frame: 0 };
      const tick = () => {
        analyser.getFloatTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        if (meter.current) {
          meter.current.style.transform = `scaleX(${Math.min(1, peak)})`;
        }
        current.frame = requestAnimationFrame(tick);
      };
      current.frame = requestAnimationFrame(tick);
      live.current = current;

      // In one-second pieces, so a long recording isn't held as one.
      recorder.start(1000);
      setState('recording');
    } catch (startError) {
      release();
      setError(micError(startError));
      setState('idle');
    }
  };

  const stop = () => {
    const recorder = live.current?.recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  /** Back to the start, as Start Over does. */
  const reset = () => {
    if (live.current) {
      live.current.recorder.onstop = null;
      stop();
      release();
    }
    setFile(null);
    setError('');
    setState('idle');
  };

  return { state, seconds, file, error, meter, start, stop, reset };
}

/** A record button, a running clock and the input level. */
export function Recorder({
  input,
  recording,
}: {
  input: RecordInput;
  recording: Recording;
}) {
  const { state, seconds, meter } = recording;
  const recordingNow = state === 'recording';
  const busy = state === 'starting' || state === 'saving';

  return (
    <div className={`${zone} border-line`}>
      <span className={tile}>
        <Mic size={18} />
      </span>
      <p className="pt-2 font-medium tabular-nums">
        {state === 'idle'
          ? input.title
          : state === 'starting'
            ? 'Starting…'
            : state === 'saving'
              ? 'Saving…'
              : formatClock(seconds)}
      </p>
      {recordingNow ? (
        <span
          aria-hidden
          className="mt-2 block h-1 w-40 overflow-hidden rounded-full bg-ink/10"
        >
          <span
            ref={meter}
            className="block h-full w-full origin-left scale-x-0 rounded-full bg-brand transition-transform duration-75"
          />
        </span>
      ) : (
        <p className="pt-0.5 text-ink-soft">{input.note}</p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          recordingNow ? recording.stop() : void recording.start()
        }
        className={`${smallButton} mt-2 disabled:opacity-40`}
      >
        {recordingNow ? 'Stop' : state === 'done' ? 'Record Again' : 'Record'}
        {recordingNow ? <Square size={13} /> : <Mic size={15} />}
      </button>
    </div>
  );
}

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Seconds since `running` last turned on; holds when it turns off. */
export function useStopwatch(running: boolean) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return seconds;
}
