import { type ReactNode, useRef } from 'react';

import { useTabScroll } from '../tabState';
import { StepList } from './StepCard';
import { StepsProvider } from './steps';
import type { Tool } from './types';

/**
 * The frame every tool page sits in: its title and description over a dotted
 * canvas, then the page's workflow (FlowNode steps joined by FlowLinks) in a
 * column down it. Steps chained from the page's results follow, one after
 * another.
 */
export function ToolLayout({
  tool,
  children,
}: {
  tool: Tool;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useTabScroll(scroller);

  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      <div ref={scroller} className="relative flex-1 overflow-y-auto">
        <div className="flow-canvas min-h-full">
          {/* The title starts about a fifth of the way down, so a page with
              only its first step sits nearer the middle than the top. */}
          <div className="mx-auto flex w-full max-w-144 flex-col items-center px-6 pt-[max(3rem,18vh)] pb-24">
            <div className="pb-6 text-center">
              <h1 className="font-serif text-[26px] leading-tight font-bold">
                {tool.name}
              </h1>
              <p className="pt-1 text-[13px] text-ink-soft">
                {tool.description}
              </p>
            </div>
            <StepsProvider>
              <div className="flex w-full flex-col">
                {children}
                <StepList />
              </div>
            </StepsProvider>
          </div>
        </div>
      </div>
    </main>
  );
}
