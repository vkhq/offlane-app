import { type ReactNode, useEffect, useRef } from 'react';

import { Link2 } from './icons';

type UrlInputProps = {
  /** Ties the field to its label; unique, as several tabs can show one. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Size and shape of the field; colours and the icon are shared. */
  className: string;
  /** Small buttons inside the field, on its right: Clear, Go. */
  trailing?: ReactNode;
  /** Shown, and can be selected and copied, but not changed. */
  readOnly?: boolean;
};

/**
 * The field used wherever a link is typed: a link icon, the input, then any
 * small buttons. Borderless, as the home page's search is when focused:
 * white and lifted on a shadow, focused or not.
 */
export function UrlInput({
  id,
  value,
  onChange,
  className,
  trailing,
  readOnly = false,
}: UrlInputProps) {
  const input = useRef<HTMLInputElement>(null);
  // Focused when its page opens, so a link can be pasted at once. Not by
  // autoFocus: a tool page's canvas is hidden until it has placed its
  // camera, and a hidden field can't take focus, so it waits (a few frames
  // at most) until it is shown. Nor if something else has focus by then.
  useEffect(() => {
    if (readOnly) return;
    let frame = 0;
    let tries = 0;
    const focus = () => {
      const element = input.current;
      if (!element) return;
      if (!element.checkVisibility({ visibilityProperty: true })) {
        if (++tries < 60) frame = requestAnimationFrame(focus);
        return;
      }
      const focused = document.activeElement;
      if (!focused || focused === document.body) {
        element.focus({ preventScroll: true });
      }
    };
    focus();
    return () => cancelAnimationFrame(frame);
    // Once, when it appears: not again when it becomes editable later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`flex items-center gap-2.5 bg-canvas text-ink-faint shadow-float ${className}`}
    >
      <Link2 size={16} className="shrink-0 -rotate-45" />
      <input
        ref={input}
        id={id}
        type="text"
        inputMode="url"
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://"
        className={`min-w-0 flex-1 bg-transparent outline-none select-text placeholder:text-ink-faint ${
          readOnly ? 'cursor-default text-ink-soft' : 'text-ink'
        }`}
      />
      {trailing}
    </div>
  );
}
