import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { type FrameSize, sizeLabel } from '../../shared/frameSize';
import type { SettingValue } from '../../shared/tools';
import {
  FlipSides,
  RotateSquareCcw,
  RotateSquareCw,
} from '../components/icons';
import {
  PlayButton,
  PlayClock,
  VideoWaiting,
  useEditorPlayback,
  useEditorVideo,
} from './editorVideo';
import type { ToolEditorProps } from './standardTool';

/** Room kept around the video on the stage, in px. */
const margin = 14;

/** Rotate's choices, by how far each turns the picture clockwise. */
const turnNames: Record<number, string> = {
  0: 'None',
  90: '90° Right',
  180: '180°',
  270: '90° Left',
};
/** What each turn reads as under the video. */
const turnWords: Record<number, string> = {
  0: '',
  90: 'Turned right',
  180: 'Upside down',
  270: 'Turned left',
};

/** An angle as 0, 90, 180 or 270. */
const quarter = (angle: number) => (((angle % 360) + 360) % 360) as number;

/** The clockwise turn a Rotate value names, 0 if none. */
const degreesOf = (value: SettingValue | undefined) =>
  Number(
    Object.entries(turnNames).find(([, name]) => name === value)?.[0] ?? 0,
  );

/** A button in the capsule under the video; Flip shows when it is on.
 *  Keeps focus off itself, as Play does, so Space stays Play's. */
function EditButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-10 cursor-pointer place-items-center rounded-full transition-colors disabled:cursor-default disabled:text-ink-faint ${pressed ? 'bg-canvas text-brand shadow-sm' : 'text-ink hover:bg-canvas/60 disabled:hover:bg-transparent'}`}
    >
      {children}
    </button>
  );
}

/**
 * Rotate Video's editor: the video on a stage, as it will come out; under
 * it a capsule of Turn Left, Flip Horizontally and Turn Right, then the
 * play button. Each turn button turns the picture a quarter that way,
 * animated, and sets the `rotate` option to match; Flip sets
 * `flipHorizontally`, which mirrors it after the turn, as the handler
 * does. The video plays as it turns.
 *
 * Turning right always turns it right on screen: with the picture
 * mirrored, that is a turn left of the video beneath. A turn chosen in the
 * options bar turns it the shorter way round.
 */
export function RotateEditor({
  media,
  values,
  onChange,
  locked,
}: ToolEditorProps) {
  const stage = useRef<HTMLDivElement>(null);
  const { source, failed, mediaKey } = useEditorVideo(media);
  const { shown, time, duration, playing, toggle, videoProps } =
    useEditorPlayback(mediaKey);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  /** The picture's turn, clockwise, counted on past a full turn so each
   *  click animates the way it was clicked. */
  const [angle, setAngle] = useState(() => degreesOf(values.rotate));
  /** Animated only once the video has its size, so it doesn't grow in. */
  const [animated, setAnimated] = useState(false);

  const original = source?.size ?? shown;
  const flipped = values.flipHorizontally === true;
  const turn = quarter(angle);
  const sideways = turn % 180 !== 0;

  // A turn chosen in the options bar: the shorter way round to it.
  const chosen = degreesOf(values.rotate);
  useEffect(() => {
    if (chosen === quarter(angle)) return;
    setAngle((current) => {
      const by = ((chosen - quarter(current) + 540) % 360) - 180;
      return current + (by === -180 ? 180 : by);
    });
    // Only when the option changes; a click sets both at once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  // The stage's size, for the video's scale.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () =>
      setRoom({ width: element.clientWidth, height: element.clientHeight });
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    measure();
    return () => watch.disconnect();
  }, []);

  const sourceKey = original ? sizeLabel(original) : '';
  useEffect(() => {
    setAnimated(false);
    if (!sourceKey) return;
    const frame = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, [sourceKey, mediaKey]);

  /** Turns it a quarter clockwise (1) or anticlockwise (-1) on screen. */
  const turnBy = (direction: 1 | -1) => {
    if (locked) return;
    const next = angle + direction * (flipped ? -90 : 90);
    setAngle(next);
    onChange({ rotate: turnNames[quarter(next)] });
  };

  /** What it comes out at, and the video as it sits on screen. */
  const output: FrameSize | null = original
    ? sideways
      ? { width: original.height, height: original.width }
      : original
    : null;
  const scale = output
    ? Math.max(
        0,
        Math.min(
          (room.width - margin * 2) / output.width,
          (room.height - margin * 2) / output.height,
        ),
      )
    : 0;
  const changes = [turnWords[turn], flipped ? 'Mirrored' : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={stage}
        className="relative aspect-video touch-none overflow-hidden rounded-2xl select-none"
      >
        {source && (
          <div
            className={`absolute top-1/2 left-1/2 -translate-1/2 rounded-[10px] bg-black ${animated ? 'transition-[transform,width,height] duration-300 ease-out motion-reduce:transition-none' : ''}`}
            style={{
              ...(original && scale > 0
                ? {
                    width: original.width * scale,
                    height: original.height * scale,
                  }
                : { width: '72%', height: '72%' }),
              // Turned, then mirrored, as the handler does it.
              transform: `scaleX(${flipped ? -1 : 1}) rotate(${angle}deg)`,
            }}
          >
            <video
              {...videoProps}
              src={source.url}
              preload="auto"
              playsInline
              className="size-full cursor-pointer rounded-[10px] object-fill"
            />
          </div>
        )}
        {!source && <VideoWaiting failed={failed} />}
      </div>

      {/* Under it: Turn Left, Flip and Turn Right in a capsule. */}
      <div className="mb-3 flex justify-center">
        <div className="flex items-center gap-0.5 rounded-full bg-linear-to-b from-group to-field p-1 shadow-lift">
          <EditButton
            label="Turn Left 90°"
            disabled={locked || !source}
            onClick={() => turnBy(-1)}
          >
            <RotateSquareCcw size={22} />
          </EditButton>
          <EditButton
            label="Flip Horizontally"
            pressed={flipped}
            disabled={locked || !source}
            onClick={() => onChange({ flipHorizontally: !flipped })}
          >
            <FlipSides size={22} />
          </EditButton>
          <EditButton
            label="Turn Right 90°"
            disabled={locked || !source}
            onClick={() => turnBy(1)}
          >
            <RotateSquareCw size={22} />
          </EditButton>
        </div>
      </div>

      {/* Then where it has played to, Play, and what it comes out as. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center rounded-2xl bg-canvas px-4 py-1.5 text-[12px] tabular-nums shadow-card">
        <PlayClock time={time} duration={duration} />
        <PlayButton
          playing={playing}
          disabled={!source || !duration}
          onClick={toggle}
        />
        <span className="justify-self-end text-right">
          {output && (
            <>
              <span className="font-medium text-ink">{sizeLabel(output)}</span>
              <span className="text-ink-soft"> ({changes || 'Unchanged'})</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
