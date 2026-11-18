import { useEffect, useRef, useState } from 'react';

import { parseValues } from '../../../shared/tools';
import type {
  JobStatus,
  QualityPreset,
  SessionStatus,
} from '../../../shared/types';
import {
  ClearButton,
  FlowLink,
  FlowNode,
  FlowNotice,
  GoButton,
  LinkField,
  OptionsBar,
  RotateCw,
  StepsFollow,
  type ToolPageProps,
  ToolLayout,
  addActivity,
  invalidLink,
  toLink,
  summarizeOptions,
  useSession,
  isDownloadGone,
  noteDownloads,
  useDownloads,
  useTabState,
} from '../../ui';
import { DownloadResults, FfmpegRow } from './DownloadList';
import { type Found, FoundCard, keepThumbnail, thumbnailOf } from './FoundCard';
import { optionsFor } from './options';
import { type SignInNeed, SignInPrompt, signInNeed } from './SignInPrompt';

const input = {
  kind: 'link',
  label: 'Video URL',
  placeholder: 'https://',
} as const;

/**
 * A link and how to save it, as a workflow. The link is looked up first;
 * only then are its options shown, built from what the lookup found, so
 * every choice is one the link can honour. Downloading adds the video, or
 * every playlist item, to the queue, and its progress follows below, then
 * the tools the file can go on to.
 */
export default function DownloadVideoPage({ tool }: ToolPageProps) {
  const [link, setLink] = useTabState('link', '');
  const [notice, setNotice] = useTabState('notice', '');
  /** Set when the site only shows the link to signed-in people. */
  const [signIn, setSignIn] = useState<SignInNeed | null>(null);
  /** The last lookup's result, for the link as it stands. */
  const [found, setFound] = useTabState<Found | null>('found', null);
  const [saved, setSaved] = useTabState<Record<string, unknown>>('values', {});
  /** The downloads this workflow started. */
  const [own, setOwn] = useTabState<string[]>('jobs', []);
  /** The found video's thumbnail, inlined, kept so a saved session shows it. */
  const [thumbnail, setThumbnail] = useTabState<string | null>(
    'thumbnail',
    null,
  );
  /** While a link is being looked up or queued. */
  const [busy, setBusy] = useState(false);
  const started = own.length > 0;
  // Once every download it started has finished, the options step goes:
  // the card leads straight on to the downloads.
  const ownJobs = useDownloads().filter((job) => own.includes(job.id));
  // How each download stands, for History; one not yet heard of has only
  // just started.
  // A download removed from the list is no longer this workflow's: it
  // drops out of the workflow and of how its session stands.
  const kept = own.filter((id) => !isDownloadGone(id));
  useEffect(() => {
    if (kept.length !== own.length) setOwn(kept);
  });
  const runs: Record<string, SessionStatus> = Object.fromEntries(
    kept.map((id) => {
      const job = ownJobs.find((candidate) => candidate.id === id);
      return [id, job ? sessionStatusOf(job.status) : 'running'];
    }),
  );
  const finished =
    started &&
    ownJobs.length > 0 &&
    ownJobs.every((job) => job.status === 'completed');

  // Built in two steps: the Download choice decides which other choices
  // there are. parseValues drops a saved choice this link does not offer.
  const download = found
    ? String(parseValues(optionsFor(found, 'Video').options, saved).download)
    : 'Video';
  const lookup = found && optionsFor(found, download);
  const values = lookup && parseValues(lookup.options, saved);

  // A session opened from History brings its thumbnail back to the card.
  if (found && thumbnail && !thumbnailOf(found)) {
    keepThumbnail({ ...found, thumbnailImage: thumbnail });
  }

  // Saved to History from the moment a link is found, and kept up to date
  // as its options are chosen and it is downloaded.
  const session = useSession(
    tool.id,
    () =>
      found && lookup && values
        ? {
            title: found.title || found.url,
            summary: [
              found.kind === 'playlist' ? 'Playlist' : null,
              ...summarizeOptions(lookup.options, values),
            ]
              .filter(Boolean)
              .join(' · '),
            thumbnail: thumbnailOf(found) ?? thumbnail,
            duration:
              found.kind === 'video' && !found.isLive ? found.duration : null,
            // The downloaded file's own shape, once there is one; till
            // then what the site said.
            aspect:
              ownJobs.find((job) => job.aspect)?.aspect ??
              (found.kind === 'video' ? found.aspectRatio : null),
            jobs: runs,
            doing: 'Downloading',
            done: 'Downloaded',
            playlist: found.kind === 'playlist' ? found.entries.length : null,
          }
        : null,
    Object.values(runs).join(),
  );

  /** Fills in a copied link and looks it up at once. */
  const paste = async () => {
    const text = (await navigator.clipboard.readText().catch(() => '')).trim();
    if (!text) return setNotice('There’s no link to paste.');
    setLink(text);
    await lookUp(text);
  };

  const startOver = () => {
    session.reset();
    setThumbnail(null);
    setLink('');
    setFound(null);
    setNotice('');
    setSignIn(null);
    setOwn([]);
  };

  // Once found, the page scrolls to its end so the options show whole
  // beneath the card, after the links have grown to their length.
  const options = useRef<HTMLElement>(null);
  const showOptions = () =>
    setTimeout(() => {
      const scroller = options.current?.closest('.overflow-y-auto');
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    }, 200);

  const lookUp = async (value = link) => {
    const url = toLink(value);
    if (!url) return setNotice(invalidLink);
    setBusy(true);
    setNotice('');
    try {
      const answer = await window.downloader.probe(url);
      if (!answer.ok) {
        // A site that wants a sign-in gets the offer to use the browser's.
        const need = signInNeed(answer.error, url);
        setSignIn(need);
        if (!need) setNotice(answer.error.message);
        return;
      }
      const result = answer.result;
      setSignIn(null);
      if (result.kind === 'playlist' && result.entries.length === 0) {
        setNotice('This playlist has no videos that can be downloaded.');
        return;
      }
      setFound(keepThumbnail(result));
      setThumbnail(result.thumbnailImage);
      session.record();
      showOptions();
    } catch (error) {
      setSignIn(null);
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const enqueue = async () => {
    if (!found || !lookup || !values) return;
    // Best, or "Best available" when there is nothing to choose, has no
    // height of its own.
    const height = lookup.heights[String(values.quality)];
    const quality: QualityPreset = lookup.audio
      ? 'audio'
      : height
        ? `${height}`
        : 'best';
    const subtitles = values.subtitles === true;
    setBusy(true);
    setNotice('');
    try {
      const requests =
        found.kind === 'playlist'
          ? found.entries.map((entry) => ({
              url: entry.url,
              quality,
              subtitles,
              title: entry.title,
              thumbnail: entry.thumbnail ?? undefined,
              duration: entry.duration ?? undefined,
            }))
          : [
              {
                url: found.url,
                quality,
                subtitles,
                probeToken: found.probeToken,
              },
            ];
      const jobs = await window.downloader.enqueue(requests);
      noteDownloads(jobs);
      addActivity(tool.id, [{ name: found.url, kind: 'link' }]);
      setOwn(jobs.map((job) => job.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const action =
    found?.kind === 'playlist'
      ? `Download ${found.entries.length}`
      : 'Download';

  const restart = (
    <GoButton label="Start Over" icon={RotateCw} onClick={startOver} />
  );

  return (
    <ToolLayout tool={tool}>
      <StepsFollow results={own.length} />
      {/* The round button at the bar's end looks the link up; once it is
          found, it starts over instead. Until it has downloaded, the link
          stays editable: a different one starts a new workflow, leaving
          any download under way to finish. Once downloaded it is fixed;
          Start Over begins another. */}
      <FlowNode>
        <LinkField
          input={input}
          value={link}
          readOnly={finished}
          compact
          onChange={(value) => {
            // A different link is a new session, from its own lookup on.
            session.reset();
            setThumbnail(null);
            setLink(value);
            setFound(null);
            setNotice('');
            setSignIn(null);
            setOwn([]);
          }}
          onSubmit={() => {
            // Return downloads once looked up, and only once.
            if (!started) void (found ? enqueue() : lookUp());
          }}
          trailing={
            found ? (
              restart
            ) : (
              <>
                {link ? (
                  <ClearButton onClick={startOver} />
                ) : (
                  // Empty: one press pastes a copied link and looks it up.
                  <button
                    type="button"
                    onClick={() => void paste()}
                    className="h-8 shrink-0 cursor-pointer rounded-full bg-well px-3 text-[13px] font-medium text-ink-soft hover:bg-field hover:text-ink"
                  >
                    Paste
                  </button>
                )}
                <GoButton label="Look Up" disabled={!link.trim() || busy} />
              </>
            )
          }
        />
        {!found && <FlowNotice>{notice}</FlowNotice>}
        {!found && !busy && !notice && !signIn && (
          // What it takes, quietly, until there is something to show.
          <p className="pt-1 text-center text-[12px] text-ink-faint">
            Works with YouTube, Instagram, TikTok, X, Vimeo and 1,800+ more
            sites
          </p>
        )}
        {!found && signIn && (
          <SignInPrompt need={signIn} onRetry={() => lookUp()} />
        )}
      </FlowNode>

      {/* One link from looking up to found, so the half drawn while looking
          up stays, and only the half down to the card grows in after. */}
      {found && lookup && values ? (
        <FlowLink
          label={found.kind === 'playlist' ? 'Playlist found' : 'Video found'}
          tone="success"
        />
      ) : (
        busy && <FlowLink label="Looking up…" tone="busy" pending />
      )}

      {found && lookup && values && (
        <>
          <FoundCard found={found} />
          {!finished && (
            <>
              <FlowLink />
              <FlowNode ref={options}>
                <OptionsBar
                  options={lookup.options}
                  values={values}
                  onChange={(key, value) =>
                    setSaved((current) => ({ ...current, [key]: value }))
                  }
                  action={action}
                  busy={busy}
                  disabled={started}
                  onRun={() => void enqueue()}
                />
                {!started && <FfmpegRow />}
                <FlowNotice>{notice}</FlowNotice>
              </FlowNode>
            </>
          )}
        </>
      )}

      <DownloadResults
        ids={own}
        thumbnail={found ? thumbnailOf(found) : undefined}
      />
    </ToolLayout>
  );
}

/** A download's status, as History shows its session. */
function sessionStatusOf(status: JobStatus): SessionStatus {
  if (status === 'completed') return 'done';
  if (status === 'canceled') return 'cancelled';
  if (status === 'paused' || status === 'failed') return status;
  return 'running';
}
