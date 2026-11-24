import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ReactNode } from 'react';

import { lengthAt, parseSpeed } from '../../shared/speed';
import { clock } from '../../shared/tools';
import { Minus, Plus } from '../components/icons';
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

/** A round − or + beside the speed pill; keeps focus off itself, as Play
 *  does, so Space stays Play's. */
function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-canvas text-ink shadow-sm transition-colors hover:bg-canvas/70 disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-canvas"
    >
      {children}
    </button>
  );
}

/**
 * Change Speed's editor: the video on a stage, playing at the speed chosen
 * (its sound keeping its pitch, as the handler's does, or silent with
 * Remove Audio); under it the speed as a pill filled up to it, between −
 * and + buttons that step one speed, dragged or moved with the arrow keys
 * along the `speed` option's choices; then the play bar, its clock in the new video's time, and the
 * length the video comes out at.
 */
export function SpeedEditor({
  media,
  options,
  values,
  onChange,
  locked,
}: ToolEditorProps) {
  const stage = useRef<HTMLDivElement>(null);
  const { source, failed, mediaKey } = useEditorVideo(media);
  const { shown, time, duration, playing, toggle, videoProps } =
    useEditorPlayback(mediaKey);
  const [room, setRoom] = useState({ width: 0, height: 0 });

  const original = source?.size ?? shown;
  const setting = options.speed;
  const choices = setting?.kind === 'select' ? setting.options : [];
  const chosen = String(values.speed ?? '');
  const index = Math.max(0, choices.indexOf(chosen));
  const speed = parseSpeed(chosen) ?? 1;
  const silent = values.removeAudio === true;

  // The preview plays at the speed, pitch kept, and is silent without sound.
  const video = videoProps.ref;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.playbackRate = speed;
    element.preservesPitch = true;
    element.muted = silent;
  }, [video, speed, silent, source, duration]);

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

  const scale = original
    ? Math.max(
        0,
        Math.min(
          (room.width - margin * 2) / original.width,
          (room.height - margin * 2) / original.height,
        ),
      )
    : 0;
  const finalLength = duration ? lengthAt(duration, speed) : null;
  /** How far along the speeds it is, for the pill's fill. */
  const fill = choices.length > 1 ? index / (choices.length - 1) : 0;
  /** One speed slower (-1) or faster (1). */
  const step = (by: -1 | 1) => {
    const next = choices[index + by];
    if (!locked && next) onChange({ speed: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={stage}
        className="relative aspect-video touch-none overflow-hidden rounded-2xl select-none"
      >
        {source && (
          <div
            className="absolute top-1/2 left-1/2 -translate-1/2 rounded-[10px] bg-black"
            style={
              original && scale > 0
                ? {
                    width: original.width * scale,
                    height: original.height * scale,
                  }
                : { width: '72%', height: '72%' }
            }
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

      {/* Under it: the speed, as a pill filled up to it between − and +
          (the slider itself is the unseen range on top of the pill, so it
          drags and takes the arrow keys). */}
      <div className="mb-3 flex justify-center">
        <div className="flex items-center gap-2.5 rounded-full bg-linear-to-b from-group to-field p-2 shadow-lift">
          <StepButton
            label="Slower"
            disabled={locked || index <= 0}
            onClick={() => step(-1)}
          >
            <Minus size={18} strokeWidth={2.5} />
          </StepButton>
          <div className="relative h-11 w-52 overflow-hidden rounded-3xl bg-field-strong has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/30">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-150 ease-out motion-reduce:transition-none"
              style={{ width: `${fill * 100}%` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] font-semibold text-white tabular-nums mix-blend-difference"
            >
              {chosen}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, choices.length - 1)}
              step={1}
              value={index}
              disabled={locked || choices.length === 0}
              aria-label="Speed"
              aria-valuetext={chosen}
              onChange={(event) =>
                onChange({ speed: choices[Number(event.target.value)] })
              }
              className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
            />
          </div>
          <StepButton
            label="Faster"
            disabled={locked || index >= choices.length - 1}
            onClick={() => step(1)}
          >
            <Plus size={18} strokeWidth={2.5} />
          </StepButton>
        </div>
      </div>

      {/* Then where it has played to, in the new video's time, Play, and
          how long it comes out. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center rounded-2xl bg-canvas px-4 py-1.5 text-[12px] tabular-nums shadow-card">
        <PlayClock time={lengthAt(time, speed)} duration={finalLength} />
        <PlayButton
          playing={playing}
          disabled={!source || !duration}
          onClick={toggle}
        />
        <span className="justify-self-end text-right">
          {speed === 1 ? (
            <span className="text-ink-soft">Choose a speed other than 1×</span>
          ) : duration && finalLength ? (
            <>
              <span className="text-ink-soft">Final length </span>
              <span className="font-medium text-ink">{clock(finalLength)}</span>
              <span className="text-ink-soft"> (from {clock(duration)})</span>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
