import {
  type ReactNode,
  createContext,
  useContext,
  useMemo,
  useState,
} from 'react';

import type { FileKind } from '../../shared/fileKinds';
import type { OutputRef, SettingValue } from '../../shared/tools';
import { useTabState } from '../tabState';

/** An earlier output a step works on, with what the page shows of it. */
export type StepInput = OutputRef & { name: string; kind: FileKind };

/**
 * One more tool run on an earlier output, shown below the page it started
 * from: a chain of steps, all in one tab.
 */
export type Step = {
  id: string;
  toolId: string;
  inputs: StepInput[];
  values: Record<string, SettingValue>;
  /** The jobs this step started, so it lists only its own results. */
  jobIds: string[];
};

type Steps = {
  steps: Step[];
  /** The step added last, to scroll to when it appears. */
  added: string | null;
  add: (toolId: string, inputs: StepInput[]) => void;
  update: (id: string, patch: Partial<Step>) => void;
  /** Removes a step, and the steps that work on its outputs. */
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
  const [steps, setSteps] = useTabState<Step[]>('steps', []);
  const [added, setAdded] = useState<string | null>(null);

  const value = useMemo<Steps>(
    () => ({
      steps,
      added,
      add: (toolId, inputs) => {
        const id = crypto.randomUUID();
        setSteps((current) => [
          ...current,
          { id, toolId, inputs, values: {}, jobIds: [] },
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
          // Whatever was made from a removed step's runs goes with it.
          const removed = new Set([id]);
          const jobs = new Set<string>();
          let grew = true;
          while (grew) {
            grew = false;
            for (const step of current) {
              if (removed.has(step.id)) {
                step.jobIds.forEach((job) => jobs.add(job));
              } else if (step.inputs.some((input) => jobs.has(input.jobId))) {
                removed.add(step.id);
                grew = true;
              }
            }
          }
          return current.filter((step) => !removed.has(step.id));
        }),
      clear: () => setSteps([]),
    }),
    [steps, added, setSteps],
  );

  return <StepsContext value={value}>{children}</StepsContext>;
}

/** The page's steps; null outside a tool page. */
export const useSteps = () => useContext(StepsContext);
