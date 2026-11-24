import type { FileKind } from '../../shared/fileKinds';
import {
  type Options,
  type OptionValues,
  type SettingValue,
  type ToolJob,
  inBar,
} from '../../shared/tools';
import { FlowLink, FlowNode, FlowNotice } from './Flow';
import { JobResults } from './JobList';
import { OptionsBar } from './OptionsBar';
import type { OptionHints, StandardTool } from './standardTool';
import type { Tool } from './types';
import { countedAction, progressive } from './verbs';

/**
 * Whether a workflow's runs fix what they ran on: once any is under way or
 * done, its input and options are a record, until Start Over. Runs that all
 * failed or were cancelled leave it open, to put right and try again.
 */
export const runsLock = (jobs: (ToolJob | undefined)[]) =>
  jobs.some(
    (job) =>
      // One not heard of yet has only just started.
      !job ||
      job.status === 'queued' ||
      job.status === 'running' ||
      job.status === 'done',
  );

/**
 * Everything after a workflow's input, the same on a tool's page and on a
 * later step, so the two can't drift apart and a new tool gets it all:
 *
 * - the tool's options as a step of their own, linked from the input with
 *   a "<Tool> Options" chip (with none, the button just follows the
 *   input), and its button, saying how many of what it runs on;
 * - once run, the options kept as a record, and the results (see
 *   JobResults), with What's Next.
 */
export function RunSection<O extends Options>({
  tool,
  config,
  values,
  hints,
  onChange,
  onFile,
  count,
  kind,
  locked,
  busy,
  notice,
  onRun,
  ids,
}: {
  tool: Tool;
  config: StandardTool<O>;
  values: OptionValues<O>;
  /** Its editor's words beside the choices (see OptionHints). */
  hints?: OptionHints;
  onChange: (key: keyof O & string, value: SettingValue) => void;
  onFile: (key: keyof O & string, file: File) => void;
  /** How many files it will run on, and of what kind, for its button
   *  ("Mute 2 Videos"); its plain action for a link or a recording. */
  count?: number;
  kind?: FileKind;
  /** Run: options kept as they were chosen, and no button. */
  locked: boolean;
  /** Holds the button: starting, or nothing to run on. */
  busy: boolean;
  notice: string;
  onRun: () => void;
  /** Its runs, for the results. */
  ids: string[];
}) {
  const { options, action } = config;
  const hasOptions = Object.keys(options).some((key) =>
    inBar(options, key, values),
  );
  const label =
    count !== undefined && kind ? countedAction(action, count, kind) : action;

  return (
    <>
      {(hasOptions || !locked) && (
        <>
          {hasOptions ? (
            <FlowLink label={`${tool.name} Options`} tone="info" />
          ) : (
            <div aria-hidden className="h-6" />
          )}
          <FlowNode>
            <OptionsBar
              options={options}
              values={values}
              hints={hints}
              onChange={onChange}
              onFile={onFile}
              action={label}
              busy={busy}
              disabled={locked}
              onRun={onRun}
            />
            <FlowNotice>{notice}</FlowNotice>
          </FlowNode>
        </>
      )}
      <JobResults
        toolId={tool.id}
        ids={ids}
        verb={progressive(action)}
        action={action}
      />
    </>
  );
}
