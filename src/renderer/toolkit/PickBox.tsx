import { Check } from '../components/icons';

/**
 * The box before a sound's name that picks it, or leaves it out: a filled
 * box with a tick when on, an outline when off. Extract Audio's tracks,
 * and a later step's sounds among several.
 */
export function PickBox({
  on,
  label,
  disabled,
  onToggle,
}: {
  on: boolean;
  /** What ticking it does, for screen readers: "Extract English". */
  label: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`grid size-5 shrink-0 place-items-center rounded-md transition-colors enabled:cursor-pointer disabled:cursor-default ${
        on ? 'bg-flow text-white' : 'ring-[1.5px] ring-ink/25 ring-inset'
      } ${disabled && !on ? 'opacity-40' : ''}`}
    >
      {on && <Check size={12} strokeWidth={3} />}
    </button>
  );
}
