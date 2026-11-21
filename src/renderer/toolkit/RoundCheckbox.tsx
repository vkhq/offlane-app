import { Check } from '../components/icons';

/**
 * A small round checkbox for picking files from a row of thumbnails (a
 * playlist's videos, the files a step works on): filled in the flow's
 * colour with a tick when on, a white ring on frosted dark when off, so it
 * reads on any picture. Placed by `className`, usually in a corner.
 */
export function RoundCheckbox({
  checked,
  label,
  disabled = false,
  onToggle,
  className = '',
}: {
  checked: boolean;
  /** What it picks, for screen readers: "Download My Video". */
  label: string;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`grid size-4.5 place-items-center rounded-full transition-colors enabled:cursor-pointer disabled:cursor-default ${
        checked
          ? 'bg-flow text-white shadow-[0_1px_3px_rgb(0_0_0/0.3)]'
          : 'bg-black/30 ring-[1.5px] ring-white/90 ring-inset backdrop-blur-sm'
      } ${className}`}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}
