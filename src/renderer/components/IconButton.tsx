import type { ReactNode } from 'react';

import type { AppIcon } from './icons';

type IconButtonProps = {
  icon: AppIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
};

export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="app-no-drag grid h-8.75 w-9 place-items-center rounded-full text-ink-soft hover:text-ink disabled:text-ink-faint disabled:hover:text-ink-faint"
    >
      <Icon size={18} />
    </button>
  );
}

/** The floating white capsule that groups toolbar buttons. */
export function Pill({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8.75 items-center rounded-full bg-canvas shadow-float">
      {children}
    </div>
  );
}
