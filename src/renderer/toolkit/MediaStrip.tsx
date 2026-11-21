import { type RefObject, useEffect, useRef, useState } from 'react';

import type { FileKind } from '../../shared/fileKinds';
import type { FilePreview } from '../../shared/types';
import {
  type AppIcon,
  File as FileIcon,
  FilePdf,
  Image,
  Link2,
  Music,
  Video,
  X,
} from '../components/icons';
import { formatBytes } from '../downloads';
import { clock } from './ResultCard';
import { RoundCheckbox } from './RoundCheckbox';

/** One file in a strip: what it is, and how to get its picture. */
export type MediaItem = {
  key: string;
  name: string;
  kind: FileKind | 'link';
  /** Its length in seconds, when already known (a download's). */
  duration?: number | null;
  /** Its size in bytes, shown under its picture, when known. */
  size?: number;
  /** Its picture and length; asked for once it comes near view. */
  preview?: () => Promise<FilePreview | null>;
};

const kindIcons: Record<MediaItem['kind'], AppIcon> = {
  video: Video,
  audio: Music,
  image: Image,
  pdf: FilePdf,
  file: FileIcon,
  link: Link2,
};

/**
 * The files a stage works on, the same wherever they came from (dropped,
 * picked in Finder, or made by an earlier stage): a row of their pictures,
 * scrolling sideways, each with its length in its bottom-right corner and
 * its size under it where the tool shows sizes.
 *
 * Files a stage picks from (an earlier stage's outputs) have, among
 * several, a round checkbox in the bottom-left to run on it or not; an
 * unticked one is dimmed. Files the user added (`onRemove`) have a ✕ in
 * the top-right instead, to take one out. Fixed once the stage has run.
 */
export function MediaStrip({
  items,
  ticked = () => true,
  locked,
  onToggle,
  onRemove,
  verb = 'Use',
}: {
  items: MediaItem[];
  ticked?: (index: number) => boolean;
  locked: boolean;
  onToggle?: (index: number) => void;
  /** Files the user added: a ✕ on each to take it out, in place of
   *  checkboxes. */
  onRemove?: (index: number) => void;
  /** What ticking one does, for screen readers: "Use clip.mp4". */
  verb?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const several = items.length > 1;
  return (
    <div
      ref={row}
      role="group"
      aria-label="Files to work on"
      className="no-scrollbar flex w-full gap-2.5 overflow-x-auto py-1 [mask-image:linear-gradient(to_right,#000_calc(100%-12px),transparent)]"
    >
      {items.map((item, index) => (
        <Thumb
          key={item.key}
          item={item}
          ticked={!several || ticked(index)}
          checkbox={several && !!onToggle}
          locked={locked}
          row={row}
          label={`${verb} ${item.name}`}
          onToggle={() => onToggle?.(index)}
          onRemove={onRemove && (() => onRemove(index))}
        />
      ))}
    </div>
  );
}

/** One file in the strip: its picture and length, once near view, and
 *  its checkbox or ✕. */
function Thumb({
  item,
  ticked,
  checkbox,
  locked,
  row,
  label,
  onToggle,
  onRemove,
}: {
  item: MediaItem;
  ticked: boolean;
  checkbox: boolean;
  locked: boolean;
  onRemove?: () => void;
  row: RefObject<HTMLDivElement | null>;
  label: string;
  onToggle: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  // Its picture is asked for once it comes within a few files of view.
  useEffect(() => {
    const element = box.current;
    if (!element || near) return;
    const watch = new IntersectionObserver(
      ([seen]) => {
        if (seen?.isIntersecting) setNear(true);
      },
      { root: row.current, rootMargin: '0px 300px' },
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, [near, row]);
  // Asked once per file: the strip is drawn afresh with new items, but
  // the same file keeps its key.
  const load = useRef(item.preview);
  load.current = item.preview;
  useEffect(() => {
    if (!near || !load.current) return;
    let live = true;
    void load
      .current()
      .then((found) => live && setPreview(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [near, item.key]);
  const Icon = kindIcons[item.kind];
  const image = preview?.thumbnail;
  const duration = item.duration ?? preview?.duration;
  const dim = ticked ? '' : 'opacity-40 grayscale';

  return (
    <div title={item.name} className="flex w-40 shrink-0 flex-col gap-1.5">
      <div
        ref={box}
        className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-group"
      >
        {image ? (
          <img
            src={image}
            alt=""
            draggable={false}
            className={`absolute inset-0 size-full object-cover transition-opacity ${dim}`}
          />
        ) : (
          <span
            className={`absolute inset-0 grid place-items-center text-ink-faint ${dim}`}
          >
            <Icon size={18} />
          </span>
        )}
        {/* Its length, in the corner opposite the checkbox. */}
        {duration ? (
          <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] leading-tight font-semibold text-white tabular-nums">
            {clock(duration)}
          </span>
        ) : null}
        {checkbox && (
          <RoundCheckbox
            checked={ticked}
            label={label}
            disabled={locked}
            onToggle={onToggle}
            className="absolute bottom-1 left-1"
          />
        )}
        {onRemove && !locked && (
          <button
            type="button"
            aria-label={`Remove ${item.name}`}
            title="Remove"
            onClick={onRemove}
            className="absolute top-1 right-1 grid size-4.5 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75"
          >
            <X size={10} strokeWidth={3} />
          </button>
        )}
      </div>
      {item.size !== undefined && (
        <span
          className={`pl-0.5 text-[11px] leading-tight text-ink-soft tabular-nums ${ticked ? '' : 'opacity-60'}`}
        >
          {formatBytes(item.size)}
        </span>
      )}
    </div>
  );
}
