import { type ReactNode, useEffect, useState } from 'react';

import { type FileKind, fileKindOf } from '../../shared/fileKinds';
import type { ToolJob } from '../../shared/tools';
import type { FilePreview } from '../../shared/types';
import {
  type AppIcon,
  File as FileIcon,
  FilePdf,
  Image,
  Music,
  Video,
} from '../components/icons';
import { formatBytes } from '../downloads';
import { tools } from '../tools';
import type { FlowTone } from './Flow';
import { useToolJobs } from './jobs';
import { AudioPlayer } from './AudioPlayer';
import { toolFile } from './PlayerModal';
import { ResultCard, revealLabel } from './ResultCard';
import { Results } from './Results';
import type { StepInput } from './steps';
import { madeLabel } from './verbs';

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

const isActive = (job: ToolJob) =>
  job.status === 'queued' || job.status === 'running';

/**
 * A tool's runs in a workflow, on its page or as a later step: the shared
 * results section (see Results.tsx), a card each. Every tool's results come
 * from here, so a new tool needs nothing of its own to show them.
 */
export function JobResults({
  toolId,
  ids,
  verb,
  action,
}: {
  toolId: string;
  ids: string[];
  /** What a run does, while it runs: Compressing. */
  verb?: string;
  /** The button that started them (Mute Video), so once done the link
   *  can say what they made: 2 Videos Muted. */
  action?: string;
}) {
  const jobs = useToolJobs(toolId).filter((job) => ids.includes(job.id));
  const status = runStatus(
    jobs.map((job) => ({
      active: isActive(job),
      done: job.status === 'done',
      progress: job.status === 'running' ? job.progress : null,
    })),
    verb,
  );
  // Once nothing is under way, what was made, rather than just Done.
  const made = jobs.filter((job) => job.status === 'done');
  const label =
    status.tone === 'done' && action && made[0]?.outputs[0]
      ? madeLabel(
          action,
          fileKindOf(made[0].outputs[0]),
          made.length,
          jobs.length,
        )
      : null;

  return (
    <Results
      status={{ label: label ?? status.label, tone: status.tone }}
      from={tools.find((tool) => tool.id === toolId)}
      items={jobs.map((job) => ({
        id: job.id,
        active: isActive(job),
        outputs: job.status === 'done' ? outputsOf(job) : [],
        render: (next) => <JobCard job={job} next={next} />,
      }))}
    />
  );
}

/** A finished run's files, as a later step's inputs. */
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
 * How much smaller a compressing tool made its input, as a share of it.
 * Only for tools that exist to make files smaller, once both sizes are
 * known.
 */
function savingsOf(job: ToolJob) {
  const { inputSize: before, outputSize: after } = job;
  if (!job.toolId.startsWith('compress-') || !before || after === undefined) {
    return null;
  }
  const change = Math.round((1 - after / before) * 100);
  return change > 0
    ? `${change}% smaller`
    : change < 0
      ? `${-change}% larger`
      : 'Same size';
}

/** A run's card: what it made (or is making), on the shared ResultCard. */
function JobCard({ job, next }: { job: ToolJob; next: ReactNode }) {
  const api = window.tools;
  const done = job.status === 'done';
  const name = done && job.outputs.length > 0 ? job.outputs[0] : job.input;
  const kind = fileKindOf(name);
  // A picture of what it made: the video it came from's, if that was
  // downloaded, or a frame, the picture itself, an album's cover (see the
  // main process).
  const [preview, setPreview] = useState<FilePreview | null>(null);
  useEffect(() => {
    if (!done) return;
    let live = true;
    void api
      .preview(job.id)
      .then((found) => live && setPreview(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, done, job.id]);
  // A GIF plays too, in the GIF player.
  const gif = done && /\.gif$/i.test(name);
  const playable = done && (kind === 'video' || gif);

  const details = done
    ? [
        name.match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase(),
        // A GIF's frames, once its preview has counted them.
        preview?.frames !== undefined && `${preview.frames} frames`,
        job.outputs.length > 1 && `${job.outputs.length} files`,
        job.outputSize !== undefined && formatBytes(job.outputSize),
        savingsOf(job),
        job.note,
      ]
        .filter(Boolean)
        .join(' · ')
    : describe(job);

  // A finished sound is its own player, in place of the card.
  if (done && kind === 'audio') {
    return (
      <AudioPlayer
        file={toolFile(job.id)}
        title={name}
        details={details}
        next={next}
        onMenu={() => void jobMenu(job, false, () => {})}
      />
    );
  }

  return (
    <ResultCard
      thumbnail={preview?.thumbnail}
      icon={kindIcons[kind]}
      duration={preview?.duration}
      title={name}
      details={details}
      failed={job.status === 'failed'}
      progress={job.status === 'running' ? job.progress : undefined}
      play={
        playable
          ? {
              file: toolFile(job.id),
              title: name,
              ...(gif && { gif: () => api.gifBytes(job.id) }),
            }
          : undefined
      }
      action={
        isActive(job)
          ? { label: 'Cancel', run: () => void api.cancel(job.id) }
          : done
            ? { label: revealLabel, run: () => void api.reveal(job.id) }
            : undefined
      }
      onMenu={(play) => void jobMenu(job, playable, play)}
      next={next}
    />
  );
}

/** A run's menu: Play for one that plays, then the rest. */
async function jobMenu(job: ToolJob, playable: boolean, onPlay: () => void) {
  const api = window.tools;
  const active = isActive(job);
  const done = job.status === 'done';
  const choice = await window.app.contextMenu([
    ...(playable ? [{ id: 'play', label: 'Play' }] : []),
    { id: 'open', label: 'Open in Default App', enabled: done },
    { id: 'reveal', label: revealLabel, enabled: done },
    { id: 'cancel', label: 'Cancel', enabled: active },
    null,
    { id: 'remove', label: 'Remove from List', enabled: !active },
  ]);
  if (choice === 'play') onPlay();
  if (choice === 'open') void api.open(job.id);
  if (choice === 'reveal') void api.reveal(job.id);
  if (choice === 'cancel') void api.cancel(job.id);
  if (choice === 'remove') void api.remove(job.id);
}

/** How a run is going, under its name. */
function describe(job: ToolJob) {
  switch (job.status) {
    case 'queued':
      return 'Waiting';
    case 'running':
      return job.progress === null
        ? 'Starting…'
        : `${Math.floor(job.progress)}%`;
    case 'done':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return job.error ?? 'Failed';
  }
}
