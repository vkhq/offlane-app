import { type ReactNode, useId } from 'react';

import { UrlInput } from '../components/UrlInput';
import type { LinkInput } from './inputs';

/**
 * One link to work on, with a note under it; Return submits it. Its label is
 * for screen readers: the step it sits in is titled with it. `trailing`
 * goes inside the field, on its right: small buttons such as Clear and Go.
 */
export function LinkField({
  input,
  value,
  onChange,
  onSubmit,
  trailing,
  readOnly,
  compact = false,
}: {
  input: LinkInput;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  trailing?: ReactNode;
  /** Shown but not changed, as once its work is done. */
  readOnly?: boolean;
  /** 56px tall rather than 64px, its button inset evenly all round. */
  compact?: boolean;
}) {
  const id = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {input.label}
      </label>
      <UrlInput
        id={id}
        value={value}
        onChange={onChange}
        trailing={trailing}
        readOnly={readOnly}
        className={`rounded-full text-[15px] ${
          compact ? 'h-14 pr-1 pl-5' : 'h-16 pr-2 pl-6'
        }`}
      />
      {input.note && (
        <p className="px-6 pt-2 text-[12px] text-ink-faint">{input.note}</p>
      )}
    </form>
  );
}
