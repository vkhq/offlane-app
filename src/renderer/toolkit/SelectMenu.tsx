import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { Check } from '../components/icons';
import { canvasMoveEvent } from './Canvas';

/**
 * A pop-up button with a macOS-style menu: frosted, translucent glass with a
 * light rim, the chosen item ticked and the item under the pointer in solid
 * blue. The menu is portalled to the body and placed by the trigger, so a
 * scrolling or clipping parent (the options bar) does not cut it off.
 */
export function SelectMenu({
  label,
  value,
  choices,
  disabled = false,
  readOnly = false,
  align = 'start',
  hint,
  field,
  onChange,
  className,
  children,
}: {
  label: string;
  value: string;
  /** Each choice as [value, label]. */
  choices: [string, string][];
  disabled?: boolean;
  /** Opens to show the choice made, the rest greyed out, but changes
   *  nothing: a step that has run. */
  readOnly?: boolean;
  /** The trigger's tooltip, when it should say more than `label`. */
  hint?: string;
  /** In place of a list, a field to type in (a number, a name). Return and
   *  Escape close the menu. */
  field?: ReactNode;
  /** Which of the trigger's edges the menu lines up with: its left, or
   *  its right, for a trigger at the end of a row. */
  align?: 'start' | 'end';
  onChange: (value: string) => void;
  className: string;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(
    null,
  );

  const close = (refocus = true) => {
    setOpen(false);
    setPlace(null);
    if (refocus) trigger.current?.focus();
  };

  const show = () => {
    setActive(
      Math.max(
        0,
        choices.findIndex(([option]) => option === value),
      ),
    );
    setOpen(true);
  };

  const pick = (index: number) => {
    const choice = choices[index];
    if (!readOnly && choice && choice[0] !== value) onChange(choice[0]);
    close();
  };

  // Below the trigger, or above it when there is no room; kept on screen.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const button = trigger.current.getBoundingClientRect();
    const { width, height } = menu.current.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const below = button.bottom + gap;
    const top =
      below + height > window.innerHeight - margin &&
      button.top - gap - height > margin
        ? button.top - gap - height
        : below;
    const left = Math.min(
      Math.max(margin, align === 'end' ? button.right - width : button.left),
      window.innerWidth - width - margin,
    );
    setPlace({ left, top });
  }, [open, align, readOnly]);

  // Once placed (a hidden menu can't take focus): a field takes the keys;
  // a list is moved through with the arrows.
  const placed = place !== null;
  useLayoutEffect(() => {
    if (!placed || !menu.current) return;
    const input = menu.current.querySelector('input');
    if (input && !readOnly) input.focus();
    else menu.current.focus();
  }, [placed, readOnly]);

  // Any press outside, scroll, the canvas moving, resize or the window
  // losing focus closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menu.current?.contains(target) &&
        !trigger.current?.contains(target)
      ) {
        close(false);
      }
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target))
        return;
      close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener(canvasMoveEvent, dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener(canvasMoveEvent, dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [open]);

  const onMenuKey = (event: React.KeyboardEvent) => {
    // Typing in a field: only Return and Escape are the menu's.
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      return;
    }
    const last = choices.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        setActive((index) => (index >= last ? 0 : index + 1));
        break;
      case 'ArrowUp':
        setActive((index) => (index <= 0 ? last : index - 1));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        pick(active);
        break;
      case 'Escape':
      case 'Tab':
        close();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        title={hint ?? label}
        aria-label={hint ?? label}
        aria-haspopup={field ? 'dialog' : 'listbox'}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
        className={className}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role={field ? 'dialog' : 'listbox'}
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            onKeyDown={onMenuKey}
            style={
              place
                ? { left: place.left, top: place.top }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
            className="fixed z-50 flex max-h-80 min-w-40 flex-col overflow-y-auto rounded-[14px] bg-menu/70 p-[5px] text-[13px] text-ink shadow-menu outline-none backdrop-blur-xl backdrop-saturate-[1.8]"
          >
            {field}
            {choices.map(([option, text], index) => {
              const chosen = option === value;
              const lit = index === active && !readOnly;
              return (
                <div
                  key={option}
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={chosen}
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(index)}
                  className={`flex h-[26px] shrink-0 cursor-default items-center gap-1.5 rounded-[8px] pr-4 pl-1.5 whitespace-nowrap ${
                    lit ? 'bg-accent text-accent-ink' : ''
                  } ${readOnly && !chosen ? 'text-ink-faint' : ''}`}
                >
                  <span className="flex w-3.5 shrink-0 justify-center">
                    {chosen && <Check size={12} strokeWidth={2.75} />}
                  </span>
                  {text}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
