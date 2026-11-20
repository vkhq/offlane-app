import {
  type DragEvent,
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from 'react';

import type { SavedFile } from '../../shared/types';
import { formatBytes } from '../downloads';
import {
  type AppIcon,
  CloudUpload,
  File as FileIcon,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Link2,
  Music,
  Play,
  Plus,
  X,
} from '../components/icons';
import { UrlInput } from '../components/UrlInput';
import type { DropInput, FileKind } from './inputs';
import { invalidLink, toLink } from './links';
import { iconButton, row, rowLabel, smallButton, tile, zone } from './styles';

/** Something to process: an uploaded or dropped file, or a link to one. */
/** A file, a link, or a file saved with a session and opened again. */
export type Item = File | string | SavedFile;

/** The drag of a row being put in order, told apart from a file drop. */
const rowDrag = 'application/x-offlane-row';

/** Lasting keys for files, so a row keeps its focus when it moves. */
const fileKeys = new WeakMap<object, string>();
function keysOf(items: Item[]) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    if (typeof item !== 'string') {
      let key = fileKeys.get(item);
      if (!key) {
        key = crypto.randomUUID();
        fileKeys.set(item, key);
      }
      return key;
    }
    // The same link twice is two rows.
    const count = (seen.get(item) ?? 0) + 1;
    seen.set(item, count);
    return `${item}#${count}`;
  });
}

/** `items` with the one at `from` moved to `to`. */
const moved = (items: Item[], from: number, to: number) => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

export const kindIcons: Record<FileKind, AppIcon> = {
  video: Play,
  audio: Music,
  image: Image,
  pdf: FileText,
  file: FileIcon,
};

/**
 * "Add Files": a drop zone with a Browse button until something is added,
 * then the list of what was added, with a row to add more. Files can be
 * dropped on either. An "Add from URL" row follows where the input allows
 * links.
 */
export function DropZone({
  input,
  items,
  onItemsChange,
  link,
  onLinkChange,
  onNotice,
}: {
  input: DropInput;
  items: Item[];
  onItemsChange: (items: Item[]) => void;
  /** The "Add from URL" field's text. */
  link: string;
  onLinkChange: (link: string) => void;
  /** Reports a problem, or '' once it is resolved. */
  onNotice: (notice: string) => void;
}) {
  const [over, setOver] = useState(false);
  /** The row being dragged into place, and the row it would go to. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const urlId = useId();
  const keys = keysOf(items);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    onItemsChange(moved(items, from, to));
  };
  const endDrag = () => {
    setDragging(null);
    setTarget(null);
  };
  const picker = useRef<HTMLInputElement>(null);

  const add = (added: Item[]) => {
    onItemsChange([...items, ...added]);
    onNotice('');
  };

  const addLink = (text: string) => {
    const url = toLink(text);
    if (url) {
      add([url]);
      onLinkChange('');
    } else {
      onNotice(invalidLink);
    }
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    // A row put back in the list, not a file: nothing to add.
    if (event.dataTransfer.types.includes(rowDrag)) return endDrag();
    const { files } = event.dataTransfer;
    // A link dragged from a browser arrives as text, not as a file.
    if (files.length > 0) add([...files]);
    else if (input.links)
      addLink(event.dataTransfer.getData('text/uri-list').split('\n')[0]);
  };

  const browse = () => picker.current?.click();

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!event.dataTransfer.types.includes(rowDrag)) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {items.length === 0 ? (
        <div
          className={`${zone} relative justify-center border border-transparent`}
        >
          {/* The dashed outline is drawn as SVG because a CSS border cannot
              set its dash length. The transparent border keeps the size. */}
          <svg
            aria-hidden
            className="pointer-events-none absolute -inset-0.5 size-[calc(100%+4px)]"
          >
            <rect
              x="1"
              y="1"
              rx="15"
              className={`h-[calc(100%-2px)] w-[calc(100%-2px)] fill-none stroke-2 [stroke-dasharray:10_6] ${
                over ? 'stroke-ink-faint' : 'stroke-line'
              }`}
            />
          </svg>
          <span className={tile}>
            <CloudUpload size={18} />
          </span>
          <p className="pt-2 font-medium">
            Choose files or drag &amp; drop them here
          </p>
          <p className="pt-0.5 text-xs text-ink-faint">
            Supports {input.formats}
          </p>
          <button
            type="button"
            onClick={browse}
            className={`${smallButton} mt-2`}
          >
            Browse
            <FolderOpen size={13} />
          </button>
        </div>
      ) : (
        <ul
          className={`max-h-60 overflow-y-auto rounded-xl ${over ? 'bg-ink/5' : ''}`}
        >
          {items.map((item, index) => {
            const isLink = typeof item === 'string';
            const Icon = isLink ? Link2 : kindIcons[input.files];
            const name = isLink ? item.replace(/^https?:\/\//, '') : item.name;
            const reorder = input.ordered && items.length > 1;
            return (
              <li
                key={keys[index]}
                className={`${row} rounded-lg ${
                  reorder
                    ? 'cursor-grab outline-none focus-visible:bg-ink/5'
                    : ''
                } ${dragging === index ? 'opacity-40' : ''} ${
                  target === index && dragging !== index ? 'bg-ink/5' : ''
                }`}
                {...(reorder && {
                  draggable: true,
                  tabIndex: 0,
                  title: 'Drag to reorder, or press Alt+↑ or Alt+↓',
                  'aria-label': `${name}, ${index + 1} of ${items.length}`,
                  onDragStart: (event: DragEvent) => {
                    event.dataTransfer.setData(rowDrag, String(index));
                    event.dataTransfer.effectAllowed = 'move';
                    setDragging(index);
                  },
                  onDragOver: (event: DragEvent) => {
                    if (!event.dataTransfer.types.includes(rowDrag)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setTarget(index);
                  },
                  onDrop: (event: DragEvent) => {
                    if (!event.dataTransfer.types.includes(rowDrag)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (dragging !== null) move(dragging, index);
                    endDrag();
                  },
                  onDragEnd: endDrag,
                  onKeyDown: (event: KeyboardEvent) => {
                    if (!event.altKey) return;
                    if (event.key === 'ArrowUp') move(index, index - 1);
                    else if (event.key === 'ArrowDown') move(index, index + 1);
                    else return;
                    event.preventDefault();
                  },
                })}
              >
                <span className={tile}>
                  <Icon size={15} />
                </span>
                <span className={rowLabel}>{name}</span>
                <span className="text-xs text-ink-faint">
                  {isLink ? 'Link' : formatBytes(item.size)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() =>
                    onItemsChange(items.filter((_, i) => i !== index))
                  }
                  className={iconButton}
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
          <li className={row}>
            <span className={tile}>
              <Plus size={15} />
            </span>
            <span className={rowLabel}>Add more, or drop them here</span>
            <button type="button" onClick={browse} className={smallButton}>
              Browse
            </button>
          </li>
        </ul>
      )}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept={input.accept}
        onChange={(event) => {
          add([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />

      {input.links && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            addLink(link);
          }}
          className={`${row} ${items.length === 0 ? 'mt-2' : ''}`}
        >
          <span className={tile}>
            <Globe size={15} />
          </span>
          <label htmlFor={urlId} className={rowLabel}>
            Add from URL
          </label>
          <UrlInput
            id={urlId}
            value={link}
            onChange={onLinkChange}
            className="h-7.5 w-60 rounded-lg px-2.5"
          />
        </form>
      )}
    </div>
  );
}
