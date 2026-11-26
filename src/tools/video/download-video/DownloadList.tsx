import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { fileKindOf } from '../../../shared/fileKinds';
import type { Job } from '../../../shared/types';
import {
  AudioPlayer,
  AudioWaveform,
  Music,
  Play,
  ResultCard,
  Results,
  downloadFile,
  formatBytes,
  revealLabel,
  type StepInput,
  runStatus,
  useDownloads,
  useToolkit,
} from '../../ui';
import { SignInPrompt, signInNeed } from './SignInPrompt';

/**
 * Which FFmpeg downloads use (the Media toolkit's), with a way to the full
 * build in Settings. Shown only until the full (GPL) build is installed:
 * after that there is nothing to act on.
 */
export function FfmpegRow() {
  const media = useToolkit('media');
  if (!media || media.installed?.variant === 'gpl') return null;
  const gplOffered = media.offers.some((offer) => offer.id === 'gpl');
  // One quiet line under the options: which codecs it has, and where to get
  // the rest. Only a missing FFmpeg is worth more than a glance.
  return (
    <p className="flex items-center justify-center gap-1.5 pt-1 text-[12px] text-ink-faint">
      <AudioWaveform size={12} />
      {media.installed ? (
        'Standard codecs'
      ) : (
        <span className="text-brand">Media toolkit not installed</span>
      )}
      {(gplOffered || !media.installed) && (
        <>
          <span aria-hidden>·</span>
          <Link
            to="/settings/toolkits"
            draggable={false}
            className="text-ink-soft underline-offset-2 hover:text-ink hover:underline"
          >
            {media.installed ? 'Get all codecs' : 'Install'}
          </Link>
        </>
      )}
    </p>
  );
}

const isActive = (job: Job) =>
  job.status === 'queued' ||
  job.status === 'probing' ||
  job.status === 'downloading' ||
  job.status === 'processing';

/**
 * This workflow's downloads: a link saying how they are going, then each
 * one as a card (see DownloadCard), a playlist's stacked, and once none is
 * still downloading, What's Next? for every video saved.
 */
export function DownloadResults({
  ids,
  thumbnail,
}: {
  ids: string[];
  /** The looked-up video's thumbnail, for a single download's card. */
  thumbnail?: string;
}) {
  const jobs = useDownloads().filter((job) => ids.includes(job.id));
  if (jobs.length === 0) return null;
  const needing = jobs.filter(
    (job) =>
      job.status === 'failed' && job.error?.action === 'use_browser_cookies',
  );
  const need = needing[0] && signInNeed(needing[0].error, needing[0].url);
  const signIn = need ? { need, jobs: needing } : null;
  const saved = jobs.filter((job) => job.status === 'completed');
  const complete = saved.length === jobs.length;
  // Nothing actually downloading, and some paused: it reads as paused,
  // with how many are done, however many finished or failed besides. Else,
  // with some cancelled, as cancelled. (As History says it.)
  const stopped = !jobs.some(isActive);
  const paused = stopped && jobs.some((job) => job.status === 'paused');
  const cancelled =
    stopped && !paused && jobs.some((job) => job.status === 'canceled');
  const tally =
    saved.length > 0 || jobs.length > 1
      ? ` · ${saved.length} of ${jobs.length} downloaded`
      : '';
  const status = complete
    ? {
        label:
          jobs.length === 1
            ? 'Download complete'
            : `${jobs.length} downloads complete`,
        tone: 'success' as const,
      }
    : paused || cancelled
      ? {
          label: `${paused ? 'Paused' : 'Cancelled'}${tally}`,
          tone: 'plain' as const,
        }
      : runStatus(
          jobs.map((job) => ({
            active: isActive(job),
            done: job.status === 'completed',
            progress:
              job.status === 'downloading'
                ? (job.progress?.percent ?? null)
                : null,
          })),
          'Downloading',
        );

  // The shared results section: a card each, a playlist's stacked, and
  // What's Next as every tool's results have it.
  return (
    <Results
      status={status}
      above={jobs.length > 1 && <PlaylistControls jobs={jobs} />}
      below={
        // A site that only shows these to signed-in people: the offer to
        // use the browser's sign-in, which retries them all.
        signIn && (
          <SignInPrompt
            need={signIn.need}
            onRetry={async () => {
              await Promise.all(
                signIn.jobs.map((job) => window.downloader.retry(job.id)),
              );
            }}
          />
        )
      }
      items={jobs.map((job) => ({
        id: job.id,
        active: isActive(job),
        outputs: job.status === 'completed' ? outputsOf(job) : [],
        // A single video has the lookup's thumbnail; a playlist's show
        // their own once looked up or saved.
        render: (next) => (
          <DownloadCard
            job={job}
            thumbnail={jobs.length === 1 ? thumbnail : undefined}
            next={next}
          />
        ),
      }))}
    />
  );
}

/**
 * A playlist's controls for all its videos at once, above their cards,
 * while any is still to finish: Pause All (Resume All once none is
 * downloading) and Cancel All. Those waiting their turn are stopped before
 * the ones downloading, so none starts in a finished one's place. A
 * cancelled video can still be retried from its own card.
 */
function PlaylistControls({ jobs }: { jobs: Job[] }) {
  const api = window.downloader;
  const active = jobs.filter(isActive);
  const paused = jobs.filter((job) => job.status === 'paused');
  if (active.length === 0 && paused.length === 0) return null;
  const waitingFirst = (list: Job[]) => [
    ...list.filter((job) => job.status === 'queued'),
    ...list.filter((job) => job.status !== 'queued'),
  ];
  const saved = jobs.filter((job) => job.status === 'completed').length;

  return (
    <div className="flex items-center justify-between gap-3 pb-3 pl-1">
      <span className="text-[13px] text-ink-soft tabular-nums">
        {saved} of {jobs.length} downloaded
      </span>
      <div className="flex items-center gap-1.5">
        {active.length > 0 ? (
          <button
            type="button"
            onClick={async () => {
              for (const job of waitingFirst(active)) await api.pause(job.id);
            }}
            className={`${pill} bg-well text-ink hover:bg-field`}
          >
            Pause All
          </button>
        ) : (
          <button
            type="button"
            onClick={async () => {
              for (const job of paused) await api.resume(job.id);
            }}
            className={`${pill} bg-well text-ink hover:bg-field`}
          >
            Resume All
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            for (const job of waitingFirst([...active, ...paused])) {
              await api.cancel(job.id);
            }
          }}
          className={`${pill} text-brand hover:bg-brand/10`}
        >
          Cancel All
        </button>
      </div>
    </div>
  );
}

/** What can be done with a download: its one main action, and its menu. */
/**
 * A download's card, on the shared ResultCard, as every tool's result is:
 * the thumbnail, the video's title (its file's name on hover) and what it
 * is (MP4 · 720p · 48 MB), Play once saved; until then its progress and
 * Pause, Resume or Retry. Show in Finder and the rest are in its menu.
 */
function DownloadCard({
  job,
  thumbnail,
  next,
}: {
  job: Job;
  thumbnail?: string;
  next: ReactNode;
}) {
  const api = window.downloader;
  const done = job.status === 'completed';
  const running = isActive(job) && job.status !== 'queued';
  const audio = job.quality === 'audio';
  const name = done ? fileNameOf(job) : null;
  // Without the lookup's thumbnail (a playlist's videos): the site's own,
  // once this download has looked its video up, else a frame of the saved
  // file. Asked again when either becomes possible.
  const [frame, setFrame] = useState<string | null>(null);
  const ready = Boolean(job.thumbnail) || done;
  useEffect(() => {
    if (thumbnail || audio || !ready || frame) return;
    let live = true;
    void api
      .preview(job.id)
      .then((image) => live && setFrame(image))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, thumbnail, audio, ready, done, frame, job.id, job.thumbnail]);
  const picture = thumbnail ?? frame;
  const title = job.title ?? name ?? job.url.replace(/^https?:\/\//, '');

  const action = done
    ? undefined
    : running || job.status === 'queued'
      ? { label: 'Pause', run: () => void api.pause(job.id) }
      : job.status === 'paused'
        ? { label: 'Resume', run: () => void api.resume(job.id) }
        : { label: 'Retry', run: () => void api.retry(job.id) };

  const openMenu = async (play: () => void) => {
    const stopped = job.status === 'failed' || job.status === 'canceled';
    const choice = await window.app.contextMenu([
      // A sound plays in its own card.
      ...(audio ? [] : [{ id: 'play', label: 'Play', enabled: done }]),
      { id: 'open', label: 'Open in Default App', enabled: done },
      { id: 'reveal', label: revealLabel, enabled: done },
      { id: 'retry', label: 'Retry', enabled: stopped },
      { id: 'cancel', label: 'Cancel', enabled: !done && !stopped },
      null,
      { id: 'debug', label: 'Copy Debug Info' },
      { id: 'remove', label: 'Remove from List' },
    ]);
    if (choice === 'play') play();
    if (choice === 'open') void api.openFile(job.id);
    if (choice === 'reveal') void api.revealFile(job.id);
    if (choice === 'retry') void api.retry(job.id);
    if (choice === 'cancel') void api.cancel(job.id);
    if (choice === 'debug') void api.copyDebugInfo(job.id);
    if (choice === 'remove') void api.remove(job.id);
  };

  // A downloaded sound is its own player, in place of the card.
  if (done && audio) {
    return (
      <AudioPlayer
        file={downloadFile(job.id)}
        title={title}
        details={detailsOf(job)}
        next={next}
        onMenu={() => void openMenu(() => {})}
      />
    );
  }

  return (
    <ResultCard
      thumbnail={audio ? null : picture}
      icon={audio ? Music : Play}
      // Its length, as on the found video's card, unless it's live.
      duration={job.isLive ? null : job.duration}
      title={title}
      hint={name ?? job.title}
      details={done ? detailsOf(job) : describe(job)}
      failed={job.status === 'failed'}
      progress={running ? (job.progress?.percent ?? null) : undefined}
      play={
        done
          ? {
              file: downloadFile(job.id),
              title,
            }
          : undefined
      }
      action={action}
      onMenu={(play) => void openMenu(play)}
      next={next}
    />
  );
}

/** A card's labelled buttons; each adds its own fill. */
const pill =
  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold';

/** The saved file's name, without its folder. */
function fileNameOf(job: Job) {
  if (!job.outputPath) return null;
  return job.outputPath.split(/[\\/]/).pop() ?? job.outputPath;
}

/** What a saved file is: MP4 · 720p · 48 MB, each part only if known. */
function detailsOf(job: Job) {
  const ext = fileNameOf(job)?.match(/\.([a-z0-9]+)$/i)?.[1];
  const quality =
    job.quality === 'audio'
      ? 'Audio'
      : job.quality === 'best'
        ? 'Best quality'
        : `${job.quality}p`;
  return [
    ext?.toUpperCase(),
    quality,
    job.fileSize ? formatBytes(job.fileSize) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A finished download's file, as a later step's input. */
function outputsOf(job: Job): StepInput[] {
  if (!job.outputPath) return [];
  const name = job.outputPath.split(/[\\/]/).pop() ?? job.outputPath;
  return [
    {
      source: 'download',
      jobId: job.id,
      index: 0,
      name,
      kind: job.quality === 'audio' ? 'audio' : fileKindOf(name),
    },
  ];
}

/** The status line under a download's title. */
/**
 * How much has come of how much: "1.2 MB of 4.8 MB", or just what has
 * come when the total isn't known (a live stream). For a video saved as
 * separate streams, it counts the part under way (see "part 1 of 2").
 */
function sizeOf(progress: NonNullable<Job['progress']>) {
  if (!progress.downloadedBytes) return null;
  const done = formatBytes(progress.downloadedBytes);
  return progress.totalBytes
    ? `${done} of ${formatBytes(progress.totalBytes)}`
    : done;
}

function describe(job: Job): string {
  const progress = job.progress;
  switch (job.status) {
    case 'queued':
      return job.retryAt
        ? `Retrying soon: ${job.error?.message ?? ''}`
        : 'Waiting';
    case 'probing':
      return 'Getting video details…';
    case 'downloading': {
      if (!progress) return 'Starting…';
      const parts = [
        progress.percent === null
          ? 'Recording'
          : `${Math.floor(progress.percent)}%`,
      ];
      if (progress.stageCount > 1) {
        parts.push(`part ${progress.stage} of ${progress.stageCount}`);
      }
      const size = sizeOf(progress);
      if (size) parts.push(size);
      if (progress.speed) parts.push(`${formatBytes(progress.speed)}/s`);
      if (progress.eta) parts.push(`${formatDuration(progress.eta)} left`);
      return parts.join(' · ');
    }
    case 'processing':
      return 'Finishing…';
    case 'paused': {
      // How much had come when it stopped.
      const size = progress && sizeOf(progress);
      return size ? `Paused · ${size}` : 'Paused';
    }
    case 'completed':
      // Shown as a Show in Finder link instead.
      return 'Done';
    case 'canceled':
      return 'Canceled';
    case 'failed':
      return job.error?.message ?? 'Failed';
  }
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
