import type { ReactNode } from 'react';

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
  return (
    <div
      className={`flex items-center gap-2.5 bg-canvas text-ink-faint shadow-float ${className}`}
    >
      <Link2 size={16} className="shrink-0 -rotate-45" />
      <input
        id={id}
        type="text"
        inputMode="url"
        autoFocus={!readOnly}
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
