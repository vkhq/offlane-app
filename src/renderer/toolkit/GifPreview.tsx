import { useRef, useState } from 'react';

import { clock } from '../../shared/tools';
import { formatBytes } from '../downloads';
import { LoaderCircle, Maximize2 } from '../components/icons';
import { PlayButton } from './editorVideo';
import { GifPlayerModal, GifScrubber, gifTimes, useGif } from './GifView';
import type { ToolPreviewProps } from './standardTool';
import { useToolPreview } from './toolPreview';

/**
 * Video to GIF's preview step: the GIF itself, made from the part and
 * options chosen (by the tool's own handler, so it is exactly what Create
 * GIF saves), looping, with its size, frame count and file size. It is
 * made again once the options rest after a change; the last one stays on
 * show, dimmed, until the next is ready. It opens larger in the GIF player.
 */
export function GifPreview({ toolId, media, values }: ToolPreviewProps) {
  const { preview, busy, percent, error } = useToolPreview(
    toolId,
    media,
    values,
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const gif = useGif(preview?.bytes ?? null, canvas);
  const { info, index, playing, toggle, seek, stop } = gif;
  const [large, setLarge] = useState(false);
  const times = info ? gifTimes(info, index) : null;
  const making =
    percent === null
      ? 'Making the preview…'
      : `Making the preview… ${Math.round(percent)}%`;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative grid aspect-video place-items-center overflow-hidden rounded-2xl bg-black">
        {/* At the GIF's own size (smaller only if it doesn't fit), so it
            looks as sharp, and as large, as it will. */}
        <canvas
          ref={canvas}
          onClick={toggle}
          aria-label="GIF preview"
          style={info ? { width: info.width, height: info.height } : undefined}
          className={`max-h-full max-w-full cursor-pointer object-contain transition-opacity duration-200 ${
            info ? '' : 'invisible absolute'
          } ${busy && info ? 'opacity-50' : ''}`}
        />
        {/* Nothing to show yet: what is happening, or why not. */}
        {!info && (
          <span className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-white/70">
            {error && !busy ? (
              error
            ) : gif.failed ? (
              gif.failed
            ) : (
              <span className="flex items-center gap-2">
                <LoaderCircle size={14} className="animate-spin" />
                {making}
              </span>
            )}
          </span>
        )}
        {/* A newer one on its way, over the last. */}
        {info && busy && (
          <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur-sm">
            <LoaderCircle size={12} className="animate-spin" />
            {percent === null
              ? 'Updating…'
              : `Updating… ${Math.round(percent)}%`}
          </span>
        )}
        {info && (
          <button
            type="button"
            aria-label="Open larger"
            title="Open larger"
            onClick={() => setLarge(true)}
            className="absolute top-3 right-3 grid size-8 cursor-pointer place-items-center rounded-full bg-black/40 text-white backdrop-blur-xl hover:bg-black/60"
          >
            <Maximize2 size={15} />
          </button>
        )}
      </div>

      {info && times && preview && (
        <div className="flex flex-col gap-1 rounded-2xl bg-canvas px-3 pt-1.5 pb-2.5 shadow-card">
          <div className="flex items-center gap-3">
            <PlayButton playing={playing} disabled={false} onClick={toggle} />
            <GifScrubber
              info={info}
              index={index}
              onSeek={(at) => {
                stop();
                seek(at);
              }}
            />
            <span className="shrink-0 text-[12px] tabular-nums">
              <span className="font-semibold">{clock(times.at)}</span>
              <span className="text-ink-faint"> / {clock(times.total)}</span>
            </span>
          </div>
          <p className="px-1 text-[12px] text-ink-soft tabular-nums">
            {info.width} × {info.height} px
            <span className="text-ink-faint"> · </span>
            {info.frames} frames
            <span className="text-ink-faint"> · </span>
            {info.plays === Infinity
              ? 'Loops'
              : info.plays === 1
                ? 'Plays once'
                : `Plays ${info.plays} times`}
            <span className="text-ink-faint"> · </span>
            <span className="font-medium text-ink">
              {formatBytes(preview.size)}
            </span>
          </p>
          {(preview.note || (error && !busy)) && (
            <p role="status" className="px-1 text-[12px] text-ink-soft">
              {error && !busy ? error : preview.note}
            </p>
          )}
        </div>
      )}

      {large && preview && (
        <GifPlayerModal
          load={() => Promise.resolve(preview.bytes)}
          title="GIF preview"
          onClose={() => setLarge(false)}
        />
      )}
    </div>
  );
}
