import { useState } from 'react';

import {
  type ToolkitId,
  type ToolkitStatus,
  type ToolkitVariantOffer,
  isInstalling,
} from '../../shared/toolkits';
import { formatBytes } from '../downloads';
import { FlowNode } from '../toolkit/Flow';
import { goButton, smallButton, zone } from '../toolkit/styles';
import { ToolLayout } from '../toolkit/ToolLayout';
import type { Tool } from '../toolkit/types';
import {
  cancelToolkit,
  installToolkit,
  needsText,
  removeToolkit,
  useMissingToolkits,
  useToolkits,
} from '../toolkits';
import { ArrowDownToLine, Check, CircleAlert } from './icons';
import { ProgressBar } from './ProgressBar';

// Toolkits as the person meets them: on a tool page whose toolkit is
// missing, in Settings, both through ToolkitCard, and on the screen shown on
// the very first launch.

/**
 * The variant installed when none is chosen, or null when it isn't offered
 * here. The first-launch screen offers only this one; a tool page or
 * Settings offers the others too, showing a licence first where there is
 * one.
 */
export const defaultOffer = (toolkit: ToolkitStatus) =>
  toolkit.offers.find((offer) => offer.default) ?? null;

/** What an install is doing, in a few words. */
export function installLine(toolkit: ToolkitStatus): string {
  const { install } = toolkit;
  switch (install.state) {
    case 'downloading':
      return `${formatBytes(install.received)}${install.total ? ` of ${formatBytes(install.total)}` : ''}`;
    case 'verifying':
      return 'Checking the download…';
    case 'extracting':
      return 'Unpacking…';
    case 'checking':
      return 'Making sure it runs…';
    default:
      return '';
  }
}

/** The install's progress, 0–100; full once the download is done. */
export const installPercent = (toolkit: ToolkitStatus): number | null =>
  toolkit.install.state !== 'downloading'
    ? 100
    : toolkit.install.total
      ? (toolkit.install.received / toolkit.install.total) * 100
      : null;

/** Size and source, said before anything is downloaded. */
export const offerLine = (offer: ToolkitVariantOffer) =>
  `About ${formatBytes(offer.size)}, from ${offer.host}`;

/** "Installed · 2026.10.26 · 120 MB", or where it comes from. */
export function installedLine(toolkit: ToolkitStatus) {
  const { installed } = toolkit;
  if (!installed) return '';
  const variant =
    toolkit.offers.length > 1
      ? toolkit.offers.find((offer) => offer.id === installed.variant)?.name
      : undefined;
  return [
    'Installed',
    variant,
    installed.version,
    installed.size ? formatBytes(installed.size) : null,
    installed.source === 'development' ? 'from vendor/' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The build an install button gets: the default, else the only kind on
 * offer here, which may carry a licence to accept first (FFmpeg's GPL build
 * on macOS, until a Standard one is published).
 */
const installOffer = (toolkit: ToolkitStatus) =>
  defaultOffer(toolkit) ?? toolkit.offers[0] ?? null;

/**
 * One toolkit, the same wherever it is shown, on a tool page that needs it
 * or in Settings: its name and contents, a line on where it stands, and the
 * one button that moves it on. While it installs, its progress and Cancel;
 * after a failure, why, and Try Again. A build under a licence asks first,
 * right here. `manage` (Settings) adds Update, Remove and the other builds.
 *
 * The install runs in the main process, so leaving the page never stops it:
 * coming back shows it still going. Only quitting the app does, and the next
 * launch starts it again.
 */
export function ToolkitCard({
  toolkit,
  manage = false,
}: {
  toolkit: ToolkitStatus;
  manage?: boolean;
}) {
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<ToolkitVariantOffer | null>(
    null,
  );
  const { installed } = toolkit;
  const busy = isInstalling(toolkit);
  const offer = installOffer(toolkit);
  const shownError =
    error || (toolkit.install.state === 'error' ? toolkit.install.message : '');

  const act = async (action: () => Promise<string | null>) => {
    setConfirming(null);
    setError('');
    setError((await action()) ?? '');
  };
  // A build under a licence is shown first; any other installs at once.
  const install = (variant: ToolkitVariantOffer) =>
    variant.license && installed?.variant !== variant.id
      ? setConfirming(variant)
      : act(() => installToolkit(toolkit.id, variant.id));

  // With Settings' extra rows: the builds other than the one installed.
  const current = installed?.variant ?? offer?.id;
  const others = manage
    ? toolkit.offers.filter((item) => item.id !== current)
    : [];

  const line = busy
    ? installLine(toolkit)
    : installed
      ? installedLine(toolkit)
      : offer
        ? `${toolkit.offers.length > 1 || !offer.default ? `${offer.name} build · ` : ''}${offerLine(offer)}`
        : toolkit.planned
          ? 'Coming in a future update.'
          : 'Not offered for this computer yet.';

  return (
    <div
      className={`flex w-full flex-col gap-2 text-left ${toolkit.planned ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">
            {toolkit.name} Toolkit
            {toolkit.contents.length > 0 && (
              <span className="font-normal text-ink-faint">
                {' '}
                · {toolkit.contents.join(', ')}
              </span>
            )}
          </p>
          <p className="truncate text-xs text-ink-soft">{line}</p>
          {manage && !busy && (
            <p className="text-xs text-ink-faint">{toolkit.description}</p>
          )}
        </div>
        {busy ? (
          <button
            type="button"
            onClick={() => cancelToolkit(toolkit.id)}
            disabled={toolkit.install.state !== 'downloading'}
            className={smallButton}
          >
            Cancel
          </button>
        ) : installed ? (
          manage && (
            <span className="flex shrink-0 items-center gap-1">
              {installed.source === 'user' && (
                <button
                  type="button"
                  onClick={() => act(() => removeToolkit(toolkit.id))}
                  className={smallButton}
                >
                  Remove
                </button>
              )}
              {toolkit.updateAvailable && (
                <button
                  type="button"
                  onClick={() => act(() => installToolkit(toolkit.id))}
                  className={goButton}
                >
                  <ArrowDownToLine size={13} />
                  Update
                </button>
              )}
            </span>
          )
        ) : (
          offer &&
          !confirming && (
            <button
              type="button"
              onClick={() => install(offer)}
              className={goButton}
            >
              <ArrowDownToLine size={13} />
              {shownError ? 'Try Again' : 'Install'}
            </button>
          )
        )}
      </div>
      {busy && (
        <ProgressBar
          label={`Installing the ${toolkit.name} toolkit`}
          value={installPercent(toolkit)}
        />
      )}
      {!busy &&
        others.map((other) => (
          <div
            key={other.id}
            className="flex items-center gap-3 border-t border-rule pt-2"
          >
            <p className="min-w-0 flex-1 text-xs text-ink-soft">
              <span className="font-medium text-ink">{other.name} build</span> ·{' '}
              {other.note}
            </p>
            {!confirming && (
              <button
                type="button"
                onClick={() => install(other)}
                className={smallButton}
              >
                {installed ? `Use ${other.name}` : 'Install'}
              </button>
            )}
          </div>
        ))}
      {confirming && !busy && (
        <div className="rounded-lg bg-group/70 px-3 py-2.5 text-xs text-ink-soft">
          <p>
            The {confirming.name} build is licensed under the{' '}
            <a
              href={confirming.license?.url}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {confirming.license?.name}
            </a>{' '}
            and isn’t part of this app. It’s downloaded from {confirming.host}{' '}
            (about {formatBytes(confirming.size)}), checked against a known
            fingerprint, and installed for your account only.
          </p>
          <div className="flex justify-end gap-1 pt-2">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className={smallButton}
            >
              Not Now
            </button>
            <button
              type="button"
              onClick={() =>
                act(() => installToolkit(toolkit.id, confirming.id))
              }
              className={goButton}
            >
              <ArrowDownToLine size={13} />
              Download and Install
            </button>
          </div>
        </div>
      )}
      {shownError && !busy && (
        <p role="status" className="flex gap-1.5 text-xs text-brand">
          <CircleAlert size={13} className="mt-px shrink-0" />
          {shownError}
        </p>
      )}
    </div>
  );
}

/** Why toolkits exist, said wherever they are listed. */
export const toolkitIntro =
  'Toolkits are the programs the app’s tools run on. They aren’t part of the app, so they’re downloaded once, checked against a known fingerprint, and kept for every tool that uses them.';

/** Where the toolkits are shown together: why they exist, then each one. */
export function ToolkitPanel({
  toolkits,
  manage = false,
}: {
  toolkits: ToolkitStatus[];
  manage?: boolean;
}) {
  return (
    <div
      className={`${zone} gap-4 border border-dashed border-line bg-canvas/60`}
    >
      <p className="text-[13px] text-ink-soft">{toolkitIntro}</p>
      <div className="flex w-full flex-col [&>*]:py-3 [&>*+*]:border-t [&>*+*]:border-rule">
        {toolkits.map((toolkit) => (
          <ToolkitCard key={toolkit.id} toolkit={toolkit} manage={manage} />
        ))}
      </div>
    </div>
  );
}

/**
 * Stands in for a tool's page while a toolkit it needs is missing: the
 * tool's title over a prompt to install each missing toolkit, where its
 * input would be. The page itself appears as soon as the last one is in.
 */
export function ToolkitGate({
  tool,
  missing,
}: {
  tool: Tool;
  missing: ToolkitStatus[];
}) {
  return (
    <ToolLayout tool={tool}>
      <FlowNode
        icon={ArrowDownToLine}
        title="Install First"
        detail={`${tool.name} needs ${missing.length > 1 ? 'these toolkits' : 'this toolkit'}`}
      >
        <ToolkitPanel toolkits={missing} />
      </FlowNode>
    </ToolLayout>
  );
}

/**
 * The first-launch screen: every toolkit, with its size, the ones not yet
 * installed ticked to install. One already there says so, and one not
 * offered for this computer says that, so the screen always tells the
 * whole story; with nothing to download, its button just carries on.
 * Installs carry on in the background once it closes, and can be followed
 * in Settings and on the tool pages.
 */
export function ToolkitSplash({ onDone }: { onDone: () => void }) {
  const toolkits = useToolkits();
  const listed = (toolkits ?? []).filter((toolkit) => !toolkit.planned);
  // What can be ticked: offered here, and not installed yet.
  const offered = listed.filter(
    (toolkit) => !toolkit.installed && defaultOffer(toolkit),
  );
  const [chosen, setChosen] = useState<Set<ToolkitId> | null>(null);
  // Everything not yet installed is ticked to begin with.
  const picked = chosen ?? new Set(offered.map((toolkit) => toolkit.id));
  const total = offered
    .filter((toolkit) => picked.has(toolkit.id))
    .reduce((sum, toolkit) => sum + (defaultOffer(toolkit)?.size ?? 0), 0);

  const toggle = (id: ToolkitId) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  const start = () => {
    for (const toolkit of offered) {
      if (picked.has(toolkit.id)) void installToolkit(toolkit.id);
    }
    onDone();
  };

  const planned = (toolkits ?? []).filter((toolkit) => toolkit.planned);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/15 px-12 py-12">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="toolkit-splash-title"
        className="flex max-h-full w-full max-w-128 flex-col overflow-hidden rounded-2xl bg-canvas/95 shadow-popup backdrop-blur-2xl"
      >
        <div className="flex flex-col gap-2 overflow-y-auto px-7 pt-7 pb-5">
          <h1
            id="toolkit-splash-title"
            className="font-serif text-[24px] leading-tight font-bold"
          >
            Choose Your Toolkits
          </h1>
          <p className="text-[13px] text-ink-soft">
            The programs the tools run on come separately, so the app stays
            small and they can update on their own. Pick what to install now;
            you can add or remove any of them later in Settings.
          </p>
          <ul className="flex flex-col pt-3 [&>*+*]:border-t [&>*+*]:border-rule">
            {listed.map((toolkit) => {
              const offer = defaultOffer(toolkit);
              const done = toolkit.installed !== null;
              const unavailable = !done && !offer;
              return (
                <li key={toolkit.id}>
                  <label
                    className={`flex items-start gap-3 py-3 ${unavailable ? 'opacity-50' : done ? '' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={done || picked.has(toolkit.id)}
                      disabled={done || unavailable}
                      onChange={() => toggle(toolkit.id)}
                      className="mt-0.5 size-4 shrink-0 accent-ink"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium">
                        {toolkit.name}
                        <span className="font-normal text-ink-faint">
                          {' '}
                          · {toolkit.contents.join(', ')}
                        </span>
                      </span>
                      <span className="block text-[13px] text-ink-soft">
                        {toolkit.description}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-[12px] text-ink-soft">
                      {done ? (
                        // A development checkout's vendor/ copy isn't a
                        // real install: say where it comes from.
                        toolkit.installed?.source === 'development' ? (
                          <span
                            title="This development build was started with OFFLANE_USE_VENDOR=1, so it uses the copy in vendor/ (npm run fetch-binaries). Start without it to see a real first launch."
                            className="flex items-center gap-1"
                          >
                            <Check size={13} /> From vendor/
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Check size={13} /> Installed
                          </span>
                        )
                      ) : offer ? (
                        formatBytes(offer.size)
                      ) : (
                        'Not offered here yet'
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {planned.length > 0 && (
            <p className="text-xs text-ink-faint">
              Coming later: {planned.map((toolkit) => toolkit.name).join(', ')}.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-rule px-7 py-4">
          <p className="flex-1 text-xs text-ink-soft">
            {total > 0 ? `About ${formatBytes(total)} to download` : ''}
          </p>
          {total > 0 && (
            <button
              type="button"
              onClick={onDone}
              className="h-7.5 shrink-0 rounded-lg bg-group px-3.5 font-medium hover:bg-field"
            >
              Not Now
            </button>
          )}
          <button
            type="button"
            onClick={start}
            className="h-7.5 shrink-0 rounded-lg bg-ink px-3.5 font-semibold text-canvas hover:opacity-90"
          >
            {total > 0 ? 'Install' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A quiet mark beside a tool whose toolkit isn't installed yet, on Home and
 * in the sidebar: the tool still opens, and its page offers the install.
 * `onImage` draws it as a white pill, for a tool's banner card.
 */
export function ToolkitBadge({
  tool,
  onImage = false,
}: {
  tool: Tool;
  onImage?: boolean;
}) {
  const missing = useMissingToolkits(tool);
  if (!missing || missing.length === 0) return null;
  const text = needsText(missing);
  return onImage ? (
    <span
      title={text}
      className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-medium text-ink backdrop-blur"
    >
      <ArrowDownToLine size={11} />
      Install
    </span>
  ) : (
    <span title={text} className="ml-auto shrink-0 text-ink-faint">
      <ArrowDownToLine size={14} />
      <span className="sr-only">{text}</span>
    </span>
  );
}
