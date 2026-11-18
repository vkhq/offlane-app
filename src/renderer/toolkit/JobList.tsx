import { type FileKind, fileKindOf } from '../../shared/fileKinds';
import type { ToolJob } from '../../shared/tools';
import {
  type AppIcon,
  ArrowRight,
  Ellipsis,
  File as FileIcon,
  FilePdf,
  Image,
  Music,
  Video,
} from '../components/icons';
import { ProgressBar } from '../components/ProgressBar';
import { formatBytes } from '../downloads';
import { tools } from '../tools';
import { FlowLink, FlowNode, type FlowTone } from './Flow';
import { useToolJobs } from './jobs';
import { NextStepNode, NextSteps } from './NextSteps';
import type { StepInput } from './steps';
import { iconButton, smallButton } from './styles';

const revealLabel = navigator.userAgent.includes('Mac')
  ? 'Show in Finder'
  : 'Show in Folder';

/**
 * What a workflow step's runs came to, as the link down to them says it:
 * spinning while any is under way, then how many are done.
 */
export function runStatus(
  states: { active: boolean; done: boolean; progress: number | null }[],
  verb = 'Working',
): { label: string; tone: FlowTone } {
  const active = states.filter((state) => state.active);
  const done = states.filter((state) => state.done).length;
  if (active.length > 0) {
    const progress = active.length === 1 ? active[0].progress : null;
    return {
      label:
        states.length > 1
          ? `${verb} · ${done} of ${states.length} done`
          : progress === null
            ? `${verb}…`
            : `${verb} · ${Math.floor(progress)}%`,
      tone: 'busy',
    };
  }
  if (done === 0) return { label: 'Didn’t finish', tone: 'failed' };
  return {
    label: done === states.length ? 'Done' : `${done} of ${states.length} done`,
    tone: 'done',
  };
}

/**
 * A workflow step's runs, newest first: a link with how they are going
 * ("Compressing · 45%"), then a card with each run's progress or what it
 * made, and the tools that can take it on. Nothing until something has run.
 */
export function JobResults({
  toolId,
  ids,
  verb,
}: {
  toolId: string;
  ids: string[];
  /** What a run does, while it runs: Compressing. */
  verb?: string;
}) {
  const jobs = useToolJobs(toolId).filter((job) => ids.includes(job.id));
  if (jobs.length === 0) return null;
  const status = runStatus(
    jobs.map((job) => ({
      active: job.status === 'queued' || job.status === 'running',
      done: job.status === 'done',
      progress: job.status === 'running' ? job.progress : null,
    })),
    verb,
  );

  return (
    <>
      <FlowLink label={status.label} tone={status.tone} />
      <FlowNode>
        <ul className="divide-y divide-hairline rounded-2xl bg-canvas px-4 shadow-card">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} inline={jobs.length > 1} />
          ))}
        </ul>
      </FlowNode>
      {jobs.length === 1 && jobs[0].status === 'done' && (
        <NextStepNode
          from={tools.find((tool) => tool.id === toolId)}
          outputs={outputsOf(jobs[0])}
        />
      )}
    </>
  );
}

const outputsOf = (job: ToolJob): StepInput[] =>
  job.outputs.map((name, index) => ({
    source: 'tool',
    jobId: job.id,
    index,
    name,
    kind: fileKindOf(name),
  }));

const kindIcons: Record<FileKind, AppIcon> = {
  video: Video,
  audio: Music,
  image: Image,
  pdf: FilePdf,
  file: FileIcon,
};

/**
 * How much smaller a compressing tool made its input: the sizes before and
 * after, and the change as a share of before. Only for tools that exist to
 * make files smaller, and only once both sizes are known.
 */
function savingsOf(job: ToolJob) {
  const { inputSize: before, outputSize: after } = job;
  if (!job.toolId.startsWith('compress-') || !before || after === undefined) {
    return null;
  }
  return { before, after, change: Math.round((1 - after / before) * 100) };
}

/**
 * One run, as a row of its step's card: what it made (or is making), a
 * tile with its kind's icon, tinted green once done or red if it failed.
 * A compressing tool's finished run shows the size before and after, how
 * much smaller it is, and a bar of the size kept. `inline` puts the tools
 * its outputs can go on to under it, for a run among several; a run on its
 * own has them as a step below instead.
 */
function JobRow({ job, inline }: { job: ToolJob; inline: boolean }) {
  const api = window.tools;
  const active = job.status === 'queued' || job.status === 'running';
  const done = job.status === 'done';
  const name =
    done && job.outputs.length > 0 ? job.outputs.join(', ') : job.input;
  const Icon = kindIcons[fileKindOf(name)];
  const savings = done ? savingsOf(job) : null;

  const openMenu = async () => {
    const choice = await window.app.contextMenu([
      { id: 'reveal', label: revealLabel, enabled: done },
      { id: 'cancel', label: 'Cancel', enabled: active },
      null,
      { id: 'remove', label: 'Remove from List', enabled: !active },
    ]);
    if (choice === 'reveal') void api.reveal(job.id);
    if (choice === 'cancel') void api.cancel(job.id);
    if (choice === 'remove') void api.remove(job.id);
  };

  return (
    <li className="flex items-center gap-3.5 py-3.5">
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-xl ${
          done
            ? 'bg-green-50 text-green-700'
            : job.status === 'failed'
              ? 'bg-brand-soft text-brand'
              : 'bg-group text-ink-soft'
        }`}
      >
        <Icon size={19} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[14px] font-medium">{name}</span>
        {job.status === 'running' && (
          <ProgressBar value={job.progress} label="Progress" />
        )}
        {savings ? (
          <>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <span className="text-ink-faint line-through decoration-ink-faint/60">
                {formatBytes(savings.before)}
              </span>
              <ArrowRight size={12} className="text-ink-faint" />
              <span className="font-semibold">
                {formatBytes(savings.after)}
              </span>
              <span
                className={`rounded-full px-2 py-px text-[12px] font-medium ${
                  savings.change > 0
                    ? 'bg-green-100 text-green-900'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {savings.change > 0
                  ? `${savings.change}% smaller`
                  : savings.change < 0
                    ? `${-savings.change}% larger`
                    : 'Same size'}
              </span>
            </span>
            {/* What's left of the original: the green share. */}
            <span
              aria-hidden
              className="mt-1 h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-group"
            >
              <span
                style={{
                  width: `${Math.min(100, Math.max(2, 100 - savings.change))}%`,
                }}
                className="block h-full rounded-full bg-green-500"
              />
            </span>
          </>
        ) : done ? (
          <span className="text-[13px] text-ink-soft">
            {job.outputSize !== undefined
              ? formatBytes(job.outputSize)
              : 'Done'}
          </span>
        ) : (
          <span
            className={`truncate text-xs ${
              job.status === 'failed' ? 'text-brand' : 'text-ink-soft'
            }`}
          >
            {describe(job)}
          </span>
        )}
        {inline && done && job.outputs.length > 0 && (
          <NextSteps
            from={tools.find((tool) => tool.id === job.toolId)}
            outputs={outputsOf(job)}
          />
        )}
      </div>
      {active && (
        <button
          type="button"
          onClick={() => api.cancel(job.id)}
          className={smallButton}
        >
          Cancel
        </button>
      )}
      {done && (
        <button
          type="button"
          onClick={() => api.reveal(job.id)}
          className={smallButton}
        >
          {revealLabel}
        </button>
      )}
      <button
        type="button"
        aria-label="More actions"
        onClick={openMenu}
        className={iconButton}
      >
        <Ellipsis size={16} />
      </button>
    </li>
  );
}

function describe(job: ToolJob) {
  switch (job.status) {
    case 'queued':
      return 'Waiting';
    case 'running':
      return job.progress === null
        ? 'Starting…'
        : `${Math.floor(job.progress)}%`;
    case 'done':
      return job.outputs.join(', ') || 'Done';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return job.error ?? 'Failed';
  }
}
