import { useEffect, useMemo, useState } from 'react';

import type { SettingValue, ToolPreview } from '../../shared/tools';
import type { MediaRef } from '../../shared/types';
import { mediaKeyOf } from './editorVideo';

/** How long the options must rest before a preview is made, in ms: a
 *  handle being dragged makes one only once it stops. */
const settle = 500;

export type ToolPreviewState = {
  /** The latest preview made; kept on show while the next is made. */
  preview: ToolPreview | null;
  /** A newer one is being made. */
  busy: boolean;
  /** How far that has got, 0–100, or null while it can't tell. */
  percent: number | null;
  /** Why the latest couldn't be made. */
  error: string;
};

/**
 * A tool's preview of what it will make from `media` with `values` (see
 * ToolsApi.makePreview), made again once the values rest after a change,
 * the one being made stopped. Stopped too when the page goes.
 */
export function useToolPreview(
  toolId: string,
  media: MediaRef | null,
  values: Record<string, SettingValue>,
): ToolPreviewState {
  const id = useMemo(() => crypto.randomUUID(), []);
  const [state, setState] = useState<ToolPreviewState>({
    preview: null,
    busy: false,
    percent: null,
    error: '',
  });
  const key = JSON.stringify([toolId, mediaKeyOf(media), values]);

  useEffect(() => {
    if (!media) return;
    let live = true;
    setState((current) => ({ ...current, busy: true, percent: null }));
    const timer = window.setTimeout(() => {
      window.tools.makePreview(id, toolId, media, values).then(
        (preview) => {
          if (live)
            setState({ preview, busy: false, percent: null, error: '' });
        },
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          // Stopped for a newer one, which will answer instead.
          if (!live || message === 'Cancelled') return;
          setState((current) => ({
            ...current,
            busy: false,
            percent: null,
            error: message,
          }));
        },
      );
    }, settle);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // Again only when what it is made from changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(
    () =>
      window.tools.onPreviewProgress((progress) => {
        if (progress.id !== id) return;
        setState((current) =>
          current.busy ? { ...current, percent: progress.percent } : current,
        );
      }),
    [id],
  );

  // Gone from the page: stop any preview still being made.
  useEffect(
    () => () => void window.tools.cancelPreview(id).catch(() => {}),
    [id],
  );

  return state;
}
