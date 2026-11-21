import {
  type ReactNode,
  createContext,
  useContext,
  useMemo,
  useState,
} from 'react';

import type { FileKind } from '../../shared/fileKinds';
import type { OutputRef, SettingValue } from '../../shared/tools';
import type { SavedFile } from '../../shared/types';
import { useTabState } from '../tabState';

/** An earlier output a step works on, with what the page shows of it. */
export type StepInput = OutputRef & { name: string; kind: FileKind };

/**
 * One more tool run on an earlier stage's outputs, shown below that stage:
 * the page's stages branch out from its first, all in one tab.
 */
export type Step = {
  id: string;
  /** The step whose outputs it works on; null for the page's own. */
  parent: string | null;
  toolId: string;
  inputs: StepInput[];
  /** Inputs left out of its run, by place: every one is ticked at first. */
  skipped?: number[];
  values: Record<string, SettingValue>;
  /** The file picked for each of its file options. */
  attachments?: Record<string, File | SavedFile>;
  /** The jobs this step started, so it lists only its own results. */
  jobIds: string[];
};

type Steps = {
  steps: Step[];
  /** The step added last, to scroll to when it appears. */
  added: string | null;
  /** Adds a step under `parent` (null: under the page's own results). */
  add: (toolId: string, inputs: StepInput[], parent: string | null) => void;
  update: (id: string, patch: Partial<Step>) => void;
  /** Removes a step, and every step branching from it. */
  remove: (id: string) => void;
  /** Removes every step, as Start Over does. */
  clear: () => void;
};

const StepsContext = createContext<Steps | null>(null);

/**
 * Keeps a page's steps with its tab, so they are still there after switching
 * tabs, and shares them with every result that can start one.
 */
export function StepsProvider({ children }: { children: ReactNode }) {
  const [saved, setSteps] = useTabState<Step[]>('steps', []);
  const [added, setAdded] = useState<string | null>(null);
  const steps = useMemo(() => withParents(saved), [saved]);

  const value = useMemo<Steps>(
    () => ({
      steps,
      added,
      add: (toolId, inputs, parent) => {
        const id = crypto.randomUUID();
        setSteps((current) => [
          ...withParents(current),
          { id, parent, toolId, inputs, values: {}, jobIds: [] },
        ]);
        setAdded(id);
      },
      update: (id, patch) =>
        setSteps((current) =>
          current.map((step) =>
            step.id === id ? { ...step, ...patch } : step,
          ),
        ),
      remove: (id) =>
        setSteps((current) => {
          const all = withParents(current);
          // Every branch from a removed step goes with it.
          const removed = new Set([id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const step of all) {
              if (
                !removed.has(step.id) &&
                step.parent &&
                removed.has(step.parent)
              ) {
                removed.add(step.id);
                grew = true;
              }
            }
          }
          return all.filter((step) => !removed.has(step.id));
        }),
      clear: () => setSteps([]),
    }),
    [steps, added, setSteps],
  );

  return <StepsContext value={value}>{children}</StepsContext>;
}

/** The page's steps; null outside a tool page. */
export const useSteps = () => useContext(StepsContext);

/**
 * Steps saved before they branched have no parent: it is the step that
 * made their first input, or the page itself.
 */
function withParents(steps: Step[]): Step[] {
  if (steps.every((step) => step.parent !== undefined)) return steps;
  return steps.map((step) => {
    if (step.parent !== undefined) return step;
    const job = step.inputs[0]?.jobId;
    const maker = steps.find((other) => job && other.jobIds.includes(job));
    return { ...step, parent: maker?.id ?? null };
  });
}

/**
 * The stage a part of the page belongs to: a step's id, or null for the
 * page's own. What's Next under a stage's results adds a branch to it.
 */
export const StageContext = createContext<string | null>(null);
