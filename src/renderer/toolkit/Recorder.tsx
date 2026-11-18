import { useEffect, useState } from 'react';

import { Mic, Square } from '../components/icons';
import type { RecordInput } from './inputs';
import { smallButton, tile, zone } from './styles';

export type RecordState = 'idle' | 'recording' | 'done';

/** A record button and a running clock (see `useStopwatch`). */
export function Recorder({
  input,
  state,
  seconds,
  onChange,
}: {
  input: RecordInput;
  state: RecordState;
  seconds: number;
  onChange: (state: RecordState) => void;
}) {
  const recording = state === 'recording';

  return (
    <div className={`${zone} border-line`}>
      <span className={tile}>
        <Mic size={18} />
      </span>
      <p className="pt-2 font-medium">
        {state === 'idle' ? input.title : formatClock(seconds)}
      </p>
      <p className="pt-0.5 text-ink-soft">{input.note}</p>
      <button
        type="button"
        onClick={() => onChange(recording ? 'done' : 'recording')}
        className={`${smallButton} mt-2`}
      >
        {recording ? 'Stop' : state === 'done' ? 'Record Again' : 'Record'}
        {recording ? <Square size={13} /> : <Mic size={15} />}
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
