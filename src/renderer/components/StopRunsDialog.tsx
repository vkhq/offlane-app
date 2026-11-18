import { useEffect, useRef } from 'react';

import type { BusyRun } from '../busyTabs';

/**
 * Asks before closing tabs whose tool is still at work (downloading,
 * compressing): closing stops it. Return or the red button closes them;
 * Escape, Keep Open or a press outside keeps them.
 */
export function StopRunsDialog({
  runs,
  tabs,
  onConfirm,
  onCancel,
}: {
  /** The runs under way in the tabs about to close. */
  runs: BusyRun[];
  /** How many of those tabs are at work. */
  tabs: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirm.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const [first] = runs;
  const one = tabs === 1;
  const title = one ? 'Close this tab?' : `Close ${tabs} tabs?`;
  const body =
    runs.length === 1
      ? `It’s still ${first.verb.toLowerCase()} “${first.name}”. Closing ${
          one ? 'the tab' : 'these tabs'
        } will stop it, and what it has done so far will be lost.`
      : `${runs.length} tasks are still running${
          runs.every((run) => run.verb === first.verb)
            ? ` (${first.verb.toLowerCase()})`
            : ''
        }. Closing ${one ? 'the tab' : 'these tabs'} will stop them, and what they have done so far will be lost.`;

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-ink/15 px-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal
        aria-labelledby="stop-runs-title"
        aria-describedby="stop-runs-body"
        className="w-full max-w-90 rounded-2xl bg-canvas/95 p-5 shadow-popup backdrop-blur-2xl backdrop-saturate-150"
      >
        <h2 id="stop-runs-title" className="text-[15px] font-semibold">
          {title}
        </h2>
        <p
          id="stop-runs-body"
          className="pt-1.5 text-[13px] leading-snug text-ink-soft"
        >
          {body}
        </p>
        <div className="flex justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 cursor-pointer rounded-lg bg-group px-3.5 text-[13px] font-medium hover:bg-field"
          >
            Keep Open
          </button>
          <button
            ref={confirm}
            type="button"
            onClick={onConfirm}
            className="h-8 cursor-pointer rounded-lg bg-brand px-3.5 text-[13px] font-medium text-white outline-none hover:opacity-90 focus-visible:ring-3 focus-visible:ring-brand/25"
          >
            {runs.length === 1 ? 'Stop & Close' : 'Stop All & Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
