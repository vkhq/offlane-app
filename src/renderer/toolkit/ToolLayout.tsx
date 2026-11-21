import type { ReactNode } from 'react';

import { Canvas } from './Canvas';
import { Branches } from './StepCard';
import { StepsProvider } from './steps';
import type { Tool } from './types';

/**
 * The frame every tool page sits in: a canvas (see Canvas.tsx) with the
 * page's first stage on it, its title and description over its workflow
 * (FlowNode steps joined by FlowLinks) in a column. The tools its results
 * go on to branch out below it, side by side, and theirs below them; once
 * they are wider or taller than the window, the canvas pans.
 */
export function ToolLayout({
  tool,
  children,
}: {
  tool: Tool;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      <StepsProvider>
        <Canvas>
          <div className="flex flex-col items-center">
            <div className="flex w-132 flex-col">
              <div className="pb-6 text-center">
                <h1 className="font-serif text-[26px] leading-tight font-bold">
                  {tool.name}
                </h1>
                <p className="pt-1 text-[13px] text-ink-soft">
                  {tool.description}
                </p>
              </div>
              {children}
            </div>
            <Branches parent={null} />
          </div>
        </Canvas>
      </StepsProvider>
    </main>
  );
}
