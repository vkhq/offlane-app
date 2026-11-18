import { useState } from 'react';

import {
  type ExternalToolsStatus,
  type FoundProgram,
  ytdlpAgeDays,
} from '../../shared/externalTools';
import { setExternalToolEnabled } from '../externalTools';
import { FlowNode } from '../toolkit/Flow';
import { goButton, zone } from '../toolkit/styles';
import { ToolLayout } from '../toolkit/ToolLayout';
import type { Tool } from '../toolkit/types';
import { CircleAlert } from './icons';

// Programs the person installed themselves (see src/shared/externalTools.ts),
// as Settings › Toolkits and a turned-off tool's page show them. Only what
// was found is ever shown: a program that isn't there goes unmentioned.

/** Why these are listed apart from the toolkits, said wherever they are. */
export const externalIntro =
  'Offlane doesn’t include or download these programs. You installed them yourself, and the tools that use them work once you turn them on.';

/** A yt-dlp older than this is said to be out of date. */
const staleDays = 60;

/** A found program's line: its version and where it is. */
export const programLine = (program: FoundProgram) =>
  `${program.version} · ${program.path}${program.chosen ? ' (chosen by you)' : ''}`;

/** A warning when the yt-dlp found is old enough to fail on some sites. */
export function ytdlpStale(status: ExternalToolsStatus): string | null {
  const age = status.ytdlp.found
    ? ytdlpAgeDays(status.ytdlp.found.version)
    : null;
  if (age === null || age < staleDays) return null;
  return `This yt-dlp is ${Math.round(age / 30)} months old. Sites change often, so update it if downloads fail.`;
}

/**
 * Stands in for a tool's page while it is turned off but the program it
 * runs is there: the tool's title over that program and a way to turn it
 * on. Reached only from an old tab or History, as the tool isn't listed
 * until then. (Without the program, the tool doesn't open at all.)
 */
export function ExternalGate({
  tool,
  found,
}: {
  tool: Tool;
  found: FoundProgram;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    setError((await setExternalToolEnabled('ytdlp', true)) ?? '');
    setBusy(false);
  };

  return (
    <ToolLayout tool={tool}>
      <FlowNode
        icon={CircleAlert}
        title="Turned Off"
        detail={`${tool.name} is off until you turn it on`}
      >
        <div
          className={`${zone} gap-4 border border-dashed border-line bg-canvas/60`}
        >
          <p className="text-[13px] text-ink-soft">{externalIntro}</p>
          <div className="flex w-full items-center gap-3 text-left">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">yt-dlp</p>
              <p className="truncate text-xs text-ink-soft">
                {programLine(found)}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void turnOn()}
              className={goButton}
            >
              Turn On {tool.name}
            </button>
          </div>
          {error && (
            <p role="alert" className="w-full text-left text-xs text-brand">
              {error}
            </p>
          )}
        </div>
      </FlowNode>
    </ToolLayout>
  );
}
