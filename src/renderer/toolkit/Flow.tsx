import { type ReactNode, type Ref, useEffect } from 'react';

import {
  type AppIcon,
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  RotateCw,
  X,
} from '../components/icons';
import { useSteps } from './steps';
import { smallButton } from './styles';

// A tool page drawn as a workflow: steps as cards down a dotted canvas,
// joined by links. A link can carry a pill saying what happened
// between two steps, or what is happening now. Each step appears once the
// one above it has done its part.

/**
 * One step of the workflow: bare, on the canvas, with no card. A small
 * label row (icon, title, a line beside it, then `aside` on the right, such
 * as Start Over) over its content; with neither title nor aside, no row.
 */
export function FlowNode({
  icon: Icon,
  title,
  detail,
  aside,
  ref,
  children,
}: {
  icon?: AppIcon;
  title?: string;
  detail?: ReactNode;
  /** On the label row's right: a remove or Start Over button. */
  aside?: ReactNode;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
}) {
  return (
    <section ref={ref} className="flex w-full scroll-mt-6 flex-col gap-1.5">
      {(title || aside) && (
        <header className="flex h-7 items-center gap-2 pl-1">
          {Icon && <Icon size={14} className="shrink-0 text-ink-faint" />}
          <h2 className="shrink-0 text-[12px] font-semibold text-ink-soft">
            {title}
          </h2>
          <p className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">
            {detail}
          </p>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** `success` marks an outcome worth showing off: found, downloaded. */
export type FlowTone = 'plain' | 'busy' | 'done' | 'success' | 'failed';

// Each tone's fill and text: soft and opaque, so the canvas's dots stay
// behind the pill.
const tones: Record<FlowTone, string> = {
  plain: 'bg-well text-neutral-700',
  busy: 'bg-flow-soft text-flow',
  done: 'bg-green-100 text-green-900',
  success: 'bg-green-100 text-green-900',
  failed: 'bg-brand-soft text-brand',
};

// What is under way, went well or went wrong carries an icon.
const toneIcons: Record<FlowTone, AppIcon | null> = {
  plain: null,
  busy: LoaderCircle,
  done: null,
  success: Check,
  failed: CircleAlert,
};

/**
 * The link down to the next step: a green line leaving a step at a hollow
 * ring and arriving at the next with an arrowhead. With a label, a pill
 * sits on it: what happened, or, spinning, what is under way; the line
 * runs plain into the pill and on from its lower edge.
 * `pending` draws only the half down to the pill, as there is nothing
 * below it yet; the other half grows in once it is cleared. Each half
 * grows to its length as it appears.
 */
export function FlowLink({
  label,
  tone = 'plain',
  pending = false,
}: {
  label?: string;
  tone?: FlowTone;
  pending?: boolean;
}) {
  const Icon = toneIcons[tone];
  return (
    <div className="flex flex-col items-center pt-1.5">
      <span className="flow-joint" />
      {label ? (
        <span className="flow-line h-6 animate-grow-down" />
      ) : (
        <Arrow length="h-10" />
      )}
      {label && (
        <>
          <span
            role="status"
            // Above anything glowing behind a neighbouring card.
            className={`relative z-10 flex h-7 max-w-full items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium ${tones[tone]}`}
          >
            {Icon && (
              <Icon
                size={12}
                strokeWidth={2.5}
                className={`shrink-0 ${tone === 'busy' ? 'animate-spin' : ''}`}
              />
            )}
            <span className="truncate">{label}</span>
          </span>
          {!pending && <Arrow length="h-7" />}
        </>
      )}
    </div>
  );
}

/**
 * A stretch of link ending in an open arrowhead, its tip at the bottom. It
 * grows down to its length when it appears, the arrowhead riding its end.
 */
function Arrow({ length }: { length: string }) {
  return (
    <span className="flex flex-col items-center text-link">
      <span className={`flow-line animate-grow-down ${length}`} />
      <svg
        aria-hidden
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="-mt-1.75"
      >
        <path d="M1 1l5 5 5-5" />
      </svg>
    </span>
  );
}

/** A line under a step: what went wrong, or what to know. */
export function FlowNotice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="status" className="px-1 text-xs text-ink-soft">
      {children}
    </p>
  );
}

/**
 * Clears the workflow back to its first step: the page's own state, through
 * `onClick`, and every step chained below it.
 */
export function StartOver({ onClick }: { onClick: () => void }) {
  const steps = useSteps();
  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        steps?.clear();
      }}
      className={smallButton}
    >
      <RotateCw size={12} />
      Start Over
    </button>
  );
}

/** Empties a field: a small ✕ inside it, on its right. */
export function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Clear"
      title="Clear"
      onClick={onClick}
      className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink-faint hover:bg-ink/5 hover:text-ink"
    >
      <X size={16} />
    </button>
  );
}

/**
 * The round button at a field's right end: submits it (Look Up), or with
 * `onClick`, acts on its own, with `icon` in place of the arrow (Start Over).
 */
export function GoButton({
  label,
  disabled = false,
  icon: Icon = ArrowRight,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  icon?: AppIcon;
  onClick?: () => void;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-canvas hover:opacity-90 disabled:cursor-default disabled:bg-ink/10 disabled:text-ink-faint disabled:hover:opacity-100"
    >
      <Icon size={18} />
    </button>
  );
}

/**
 * Keeps the chained steps in line with the page's own results: every step
 * works on an output of one, so once the page has none (started over, or a
 * new link typed in), the steps go too.
 */
export function StepsFollow({ results }: { results: number }) {
  const steps = useSteps();
  const stale = results === 0 && (steps?.steps.length ?? 0) > 0;
  useEffect(() => {
    if (stale) steps?.clear();
  }, [stale, steps]);
  return null;
}
