import type { ReactNode } from 'react';

import type { Tool } from './types';
import { FlowLink, FlowNode, type FlowTone } from './Flow';
import { NextStepNode, NextSteps } from './NextSteps';
import type { StepInput } from './steps';

/** One result in a results section: a card, and what it made. */
export type ResultItem = {
  id: string;
  /** Still under way (or waiting, or paused): What's Next waits for it. */
  active: boolean;
  /** What it made, as a later step's inputs; none until it has. */
  outputs: StepInput[];
  /** Its card (see ResultCard), given What's Next? for it, when it has
   *  one of its own. */
  render: (next: ReactNode) => ReactNode;
};

/**
 * Where a workflow's results show, for every tool and for downloads alike,
 * so they all behave the same:
 *
 * - a link down to them, saying how they are going or what was made;
 * - a card each (`above` and `below` add a section's own, as a playlist's
 *   controls);
 * - What's Next: among several results, a chip on each card for that one;
 *   and once none is still under way, the What's Next? button below for
 *   everything they made, together.
 */
export function Results({
  status,
  items,
  from,
  above,
  below,
}: {
  status: { label: string; tone: FlowTone };
  items: ResultItem[];
  /** The tool that made them, whose group comes first in What's Next. */
  from?: Tool;
  above?: ReactNode;
  below?: ReactNode;
}) {
  if (items.length === 0) return null;
  const several = items.length > 1;
  const made = items.flatMap((item) => item.outputs);
  const settled = !items.some((item) => item.active);

  return (
    <>
      <FlowLink label={status.label} tone={status.tone} />
      <FlowNode>
        {above}
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              {item.render(
                several && item.outputs.length > 0 ? (
                  <NextSteps outputs={item.outputs} from={from} />
                ) : null,
              )}
            </li>
          ))}
        </ul>
        {below}
      </FlowNode>
      {settled && made.length > 0 && (
        <NextStepNode outputs={made} from={from} />
      )}
    </>
  );
}
