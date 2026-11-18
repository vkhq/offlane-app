import { type ReactNode, useEffect, useState } from 'react';

import type {
  StorageGroup,
  StorageItem,
  StorageItemId,
  StorageReport,
} from '../../shared/storage';
import type { BrowserChoice, Settings } from '../../shared/types';
import { changelog } from '../changelog';
import { formatBytes } from '../downloads';
import { useToolkits } from '../toolkits';
import {
  closeSettings,
  setSettingsGroup,
  useSettingsModal,
} from '../settingsModal';
import {
  type AppIcon,
  AudioWaveform,
  ChevronRight,
  FileText,
  Folder,
  LayoutGrid,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from './icons';
import { goButton, smallButton } from '../toolkit/styles';
import { isMac } from './keys';
import { ToolkitCard, installedLine, toolkitIntro } from './Toolkits';
import { externalIntro, programLine, ytdlpStale } from './ExternalTools';
import {
  chooseYtdlp,
  forgetChosenYtdlp,
  rescanExternalTools,
  setExternalToolEnabled,
  useExternalTools,
} from '../externalTools';

// Settings, as a popup over the app, built from the app's own pieces: the
// rail's warm wash and brand-tinted selection for the groups, a serif title
// as on every page, and the tool pages' option rows (label, then
// control) with their switches, fields and buttons.

// The tool pages' buttons: a quiet text one, and the one that moves on.
const softButton = `${smallButton} disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-transparent`;
const strongButton = goButton;
/** A destructive action's final button. */
const dangerButton = goButton.replace('bg-ink', 'bg-brand');

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type Group = {
  id: string;
  name: string;
  icon: AppIcon;
  /** What else a search finds the group by: the settings in it. */
  keywords: string;
  content: () => ReactNode;
};

const navSections: { title: string; groups: Group[] }[] = [
  {
    title: 'Settings',
    groups: [
      {
        id: 'preferences',
        name: 'Preferences',
        icon: SlidersHorizontal,
        keywords:
          'downloads folder simultaneous compatible formats metadata proxy speed limit network sign in cookies browser instagram login',
        content: () => <Preferences />,
      },
      {
        id: 'toolkits',
        name: 'Toolkits',
        icon: AudioWaveform,
        keywords:
          'toolkits install update remove media engine ffmpeg ffprobe codecs gpl lgpl x264 x265 pdf ocr ai found on this computer installed programs yt-dlp download video turn on enable',
        content: () => <Toolkits />,
      },
      {
        id: 'storage',
        name: 'Storage',
        icon: Folder,
        keywords:
          'storage disk space data cache files delete clear erase reset privacy history downloads where saved size',
        content: () => <Storage />,
      },
      {
        id: 'shortcuts',
        name: 'Shortcuts',
        icon: LayoutGrid,
        keywords: 'keyboard keys tabs back forward search home history sidebar',
        content: () => <Shortcuts />,
      },
    ],
  },
  {
    title: 'About',
    groups: [
      {
        id: 'updates',
        name: 'Updates',
        icon: RefreshCw,
        keywords: 'version yt-dlp ffmpeg toolkits',
        content: () => <Updates />,
      },
      {
        id: 'changelog',
        name: 'Changelog',
        icon: FileText,
        keywords: 'release notes what’s new version',
        content: () => <Changelog />,
      },
    ],
  },
];

const groups = navSections.flatMap((section) => section.groups);

/** App settings in a popup, shown while the settings store says so. */
export function SettingsModal() {
  const { open, group: current } = useSettingsModal();
  const [query, setQuery] = useState('');

  // Esc closes it, as it does Quick Search.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Each opening starts with an empty search.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  if (!open) return null;

  const needle = query.trim().toLowerCase();
  const matches = (group: Group) =>
    `${group.name} ${group.keywords}`.toLowerCase().includes(needle);
  const shown = groups.filter(matches);
  // While searching, show the chosen group if it matches, else the first
  // group that does.
  const group =
    shown.find((candidate) => candidate.id === current) ?? shown[0] ?? null;

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-ink/15 px-12 pt-16 pb-12"
      // Only a press outside the popup closes it, as with Quick Search.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSettings();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Settings"
        className="flex h-full max-h-200 w-full max-w-260 flex-col overflow-hidden rounded-2xl bg-canvas/90 shadow-popup backdrop-blur-2xl backdrop-saturate-150"
      >
        {/* The modal's own title bar, across both columns. */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-rule pr-3 pl-5.5">
          <h2 className="text-[16px] font-medium">Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            title="Close (Esc)"
            onClick={closeSettings}
            className="grid size-8 place-items-center rounded-full text-ink hover:bg-group"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings groups"
            className="flex w-55 shrink-0 flex-col overflow-y-auto border-r border-rule pt-4 pr-4 pb-4 pl-5.5"
          >
            {/* A boxed field: hairline outline, rounded corners. */}
            <label className="flex h-7 shrink-0 items-center gap-3.5 rounded-lg border border-rule bg-canvas/60 px-2.5 text-ink-soft focus-within:border-ink-faint">
              <Search size={16} className="shrink-0" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search settings"
                className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink caret-accent outline-none select-text placeholder:text-ink-faint"
              />
            </label>

            {navSections.map((section) => {
              const listed = section.groups.filter(matches);
              if (listed.length === 0) return null;
              return (
                <div key={section.title} className="pt-6">
                  <p className="pb-3 text-[13px] leading-4 text-ink-soft">
                    {section.title}
                  </p>
                  <ul className="flex flex-col gap-px">
                    {listed.map(({ id, name, icon: Icon }) => {
                      const active = id === group?.id;
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            aria-current={active ? 'page' : undefined}
                            onClick={() => setSettingsGroup(id)}
                            className={`flex h-8 w-full items-center gap-3.5 rounded-lg px-2.5 text-left text-[14.5px] text-ink ${
                              active ? 'bg-ink/8' : 'hover:bg-ink/4'
                            }`}
                          >
                            <Icon size={17} className="shrink-0" />
                            <span className="truncate">{name}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {shown.length === 0 && (
              <p className="pt-6 text-[14.5px] text-ink-soft">No Results</p>
            )}
          </nav>

          {/* Keyed, so each group starts with its own fresh state. */}
          <div
            key={group?.id}
            className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-5 pb-8"
          >
            {group ? (
              group.content()
            ) : (
              <p className="text-[14.5px] text-ink-soft">
                No settings match “{query.trim()}”.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A group of settings, drawn as a tool page draws a step that needs a
 * toolkit: a small heading (with an optional line beside it), then a
 * dashed, rounded panel holding the rows, divided by hairlines. `intro` is
 * the panel's own lead paragraph, centred, as on that page.
 */
function Section({
  title,
  detail,
  intro,
  footer,
  children,
}: {
  title: string;
  detail?: ReactNode;
  intro?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <header className="flex h-7 items-center gap-2 pl-1">
        <h2 className="shrink-0 text-[12px] font-semibold text-ink-soft">
          {title}
        </h2>
        {detail && (
          <p className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">
            {detail}
          </p>
        )}
      </header>
      <div className={panel}>
        {intro && (
          <p className="pt-3 pb-1 text-[13px] text-ink-soft">{intro}</p>
        )}
        {/* Rows divided by hairlines, none above the first or below the last. */}
        <div className="flex flex-col [&>*]:py-3 [&>*+*]:border-t [&>*+*]:border-rule">
          {children}
        </div>
        {footer && <div className="pb-3">{footer}</div>}
      </div>
    </section>
  );
}

/** The panel itself, as round a tool page's missing toolkit. */
const panel =
  'flex w-full flex-col rounded-xl border border-dashed border-line bg-canvas/60 px-6 py-2';

/** An option row: its name (and a line under it), then its control. */
function Row({
  label,
  note,
  children,
}: {
  label: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{label}</p>
        {note && <p className="text-xs text-ink-soft">{note}</p>}
      </div>
      {children}
    </div>
  );
}

/** A question asked before a step that can't be undone, inside its panel. */
function Confirm({
  children,
  action,
  danger = false,
  onConfirm,
  onCancel,
}: {
  children: ReactNode;
  action: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg bg-group/70 px-3 py-2.5 text-xs text-ink-soft">
      <p>{children}</p>
      <div className="flex justify-end gap-1 pt-2">
        <button type="button" onClick={onCancel} className={softButton}>
          Not Now
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={danger ? dangerButton : strongButton}
        >
          {action}
        </button>
      </div>
    </div>
  );
}

/** The tool pages' select: the value and a chevron over a native menu. */
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative flex min-w-0 items-center gap-1.5 pr-1 text-[13px] text-ink">
      <span className="truncate">{value}</span>
      <ChevronRight size={13} className="shrink-0 rotate-90 text-ink-soft" />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function Switch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex h-5.5 w-9.5 shrink-0 items-center rounded-full px-0.5 transition-colors duration-150 disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-field-strong'
      }`}
    >
      <span
        className={`size-4.5 rounded-full bg-canvas shadow-float transition-transform duration-150 ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  );
}

/** A text field saved on Return or when it loses focus, so a half-typed
 *  proxy isn't rejected on every key. */
function TextField({
  label,
  placeholder,
  value,
  onSave,
}: {
  label: string;
  placeholder: string;
  value: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
      onBlur={() => draft !== value && onSave(draft)}
    >
      <input
        type="text"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        className="h-7 w-52 rounded-lg bg-group px-2.5 text-right text-[13px] outline-none select-text placeholder:text-ink-faint focus:ring-3 focus:ring-accent/50"
      />
    </form>
  );
}

const Value = ({ children }: { children: ReactNode }) => (
  <span className="truncate text-xs text-ink-soft">{children}</span>
);

const Footnote = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-ink-faint">{children}</p>
);

/** The app's version, loaded once per group shown. */
function useAppVersion() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.app.version().then(setVersion);
  }, []);
  return version;
}

function Preferences() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [browsers, setBrowsers] = useState<BrowserChoice[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.downloader.getSettings().then(setSettings);
    void window.downloader.browsers().then(setBrowsers);
  }, []);

  if (!settings) return null;

  const save = async (patch: Partial<Settings>) => {
    setError('');
    try {
      setSettings(await window.downloader.updateSettings(patch));
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const chooseFolder = async () => {
    const dir = await window.downloader.chooseDownloadDir();
    if (dir) setSettings({ ...settings, downloadDir: dir });
  };

  return (
    <>
      <Section title="Downloads">
        <Row label="Download Folder" note={settings.downloadDir}>
          <button type="button" onClick={chooseFolder} className={softButton}>
            Change…
          </button>
        </Row>
        <Row label="Simultaneous Downloads">
          <Select
            label="Simultaneous downloads"
            value={String(settings.maxConcurrent)}
            options={['1', '2', '3', '4', '5']}
            onChange={(value) => save({ maxConcurrent: Number(value) })}
          />
        </Row>
        <Row
          label="Prefer Compatible Formats"
          note="H.264 video and AAC audio, which play everywhere."
        >
          <Switch
            label="Prefer compatible formats"
            checked={settings.preferCompatible}
            onChange={(preferCompatible) => save({ preferCompatible })}
          />
        </Row>
        <Row
          label="Embed Metadata"
          note="Title, chapters and other details saved in the file."
        >
          <Switch
            label="Embed metadata"
            checked={settings.embedMetadata}
            onChange={(embedMetadata) => save({ embedMetadata })}
          />
        </Row>
        <Row
          label="Use Sign-ins From"
          note="For sites that only show videos to signed-in people, such as Instagram: downloads use your sign-in from this browser. The app reads its cookies, never your passwords."
        >
          <Select
            label="Use sign-ins from"
            value={
              browsers.find((browser) => browser.id === settings.cookiesBrowser)
                ?.name ?? 'None'
            }
            options={['None', ...browsers.map((browser) => browser.name)]}
            onChange={(name) =>
              save({
                cookiesBrowser:
                  browsers.find((browser) => browser.name === name)?.id ?? '',
              })
            }
          />
        </Row>
      </Section>
      <Section
        title="Network"
        footer={
          error && (
            <p role="status" className="text-xs text-brand">
              {error}
            </p>
          )
        }
      >
        <Row label="Proxy">
          <TextField
            label="Proxy"
            placeholder="socks5://127.0.0.1:1080"
            value={settings.proxy}
            onSave={(proxy) => save({ proxy })}
          />
        </Row>
        <Row label="Speed Limit" note="Such as 500K or 5M a second.">
          <TextField
            label="Speed limit"
            placeholder="Unlimited"
            value={settings.rateLimit}
            onSave={(rateLimit) => save({ rateLimit })}
          />
        </Row>
      </Section>
    </>
  );
}

/**
 * Every toolkit, shown as the tool pages show one that's missing (see
 * ToolkitCard), with Update, Remove and the other builds besides. Tool pages
 * are where toolkits are usually installed, so nothing here is needed first.
 */
function Toolkits() {
  const toolkits = useToolkits();
  if (!toolkits) return null;
  // The ones offered first, then those still to come.
  const sorted = [
    ...toolkits.filter((toolkit) => !toolkit.planned),
    ...toolkits.filter((toolkit) => toolkit.planned),
  ];
  return (
    <>
      <Section
        title="Toolkits"
        detail="Installed for every tool that uses them"
        intro={toolkitIntro}
      >
        {sorted.map((toolkit) => (
          <ToolkitCard key={toolkit.id} toolkit={toolkit} manage />
        ))}
      </Section>
      <FoundPrograms />
    </>
  );
}

/**
 * The programs the person installed themselves that were found: only those,
 * and nothing at all when none were. Today that is yt-dlp, with a way to
 * look again or point at another copy, and the switch that turns Download
 * Video on.
 */
function FoundPrograms() {
  const status = useExternalTools();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const found = status?.ytdlp.found;
  if (!status || !found) return null;
  const stale = ytdlpStale(status);

  const act = async (change: () => Promise<string | null>) => {
    setBusy(true);
    setError((await change()) ?? '');
    setBusy(false);
  };

  return (
    <Section
      title="Found on This Computer"
      detail="Programs you installed yourself"
      intro={externalIntro}
      footer={
        error ? (
          <p role="alert" className="text-xs text-brand">
            {error}
          </p>
        ) : null
      }
    >
      <Row
        label="yt-dlp"
        note={
          <>
            <span className="break-all">{programLine(found)}</span>
            {stale && <span className="block text-brand">{stale}</span>}
          </>
        }
      >
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(found.chosen ? forgetChosenYtdlp : chooseYtdlp)
            }
            className={softButton}
          >
            {found.chosen ? 'Find on Its Own' : 'Choose…'}
          </button>
          <button
            type="button"
            disabled={busy || status.scanning}
            onClick={() => void act(rescanExternalTools)}
            className={softButton}
          >
            Look Again
          </button>
        </span>
      </Row>
      <Row
        label="Download Video"
        note="Adds the Download Video tool, which runs the yt-dlp above."
      >
        <Switch
          label="Download Video"
          checked={status.ytdlp.enabled}
          disabled={busy}
          onChange={(on) => void act(() => setExternalToolEnabled('ytdlp', on))}
        />
      </Row>
    </Section>
  );
}

// Each group's colour in the bar across the top of Storage.
const groupColors: Record<StorageGroup, string> = {
  'Your Files': 'bg-brand',
  'App Data': 'bg-flow',
  Caches: 'bg-accent',
  'Electron and System': 'bg-ink-faint',
};

const storageGroups = Object.keys(groupColors) as StorageGroup[];

const showLabel = isMac ? 'Show in Finder' : 'Show in Folder';

/**
 * Everything the app keeps on this computer: the files it saved for you,
 * its own data, its caches, and what Electron and the system keep for it,
 * each with its size and where it is, and a way to clear what can be.
 */
function Storage() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [busy, setBusy] = useState<StorageItemId | 'all' | null>(null);
  const [confirming, setConfirming] = useState<StorageItemId | 'all' | null>(
    null,
  );
  const [error, setError] = useState('');

  const measure = () => {
    setError('');
    window.storage
      .report()
      .then(setReport)
      .catch((failure) => setError(errorText(failure)));
  };
  useEffect(measure, []);

  /** Runs an action that answers with a fresh report. */
  const act = async (
    which: StorageItemId | 'all',
    action: () => Promise<StorageReport>,
  ) => {
    setConfirming(null);
    setError('');
    setBusy(which);
    try {
      setReport(await action());
    } catch (failure) {
      setError(errorText(failure));
      measure();
    } finally {
      setBusy(null);
    }
  };

  const clear = (item: StorageItem) => {
    if (item.clear?.confirm && confirming !== item.id) {
      setConfirming(item.id);
      return;
    }
    void act(item.id, () => window.storage.clear(item.id));
  };

  if (!report) {
    return (
      <p className="px-1 text-[13px] text-ink-soft">
        {error || 'Measuring what the app keeps…'}
      </p>
    );
  }

  const byGroup = (group: StorageGroup) =>
    report.items.filter((item) => item.group === group);
  const groupSize = (group: StorageGroup) =>
    byGroup(group).reduce((sum, item) => sum + item.size, 0);

  return (
    <>
      <Section
        title="On This Computer"
        detail={`The app’s own data is in ${report.dataFolder}`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[22px] leading-none font-semibold tracking-tight">
                {formatBytes(report.total)}
              </p>
              <p className="truncate pt-1.5 text-xs text-ink-soft">
                Everything the app keeps, by kind.
              </p>
            </div>
            <button
              type="button"
              onClick={measure}
              disabled={busy !== null}
              className={softButton}
            >
              Measure Again
            </button>
          </div>
          {/* One bar, a share per group, in the groups' colours. */}
          <div
            role="img"
            aria-label="Space used by each kind of data"
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-group"
          >
            {storageGroups.map((group) => {
              const size = groupSize(group);
              return size > 0 ? (
                <span
                  key={group}
                  title={`${group}: ${formatBytes(size)}`}
                  className={`${groupColors[group]} min-w-1`}
                  style={{ flexGrow: size }}
                />
              ) : null;
            })}
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
            {storageGroups.map((group) => (
              <li key={group} className="flex items-center gap-1.5">
                <span className={`size-2 rounded-full ${groupColors[group]}`} />
                {group} · {formatBytes(groupSize(group))}
              </li>
            ))}
          </ul>
          {error && (
            <p role="status" className="text-xs text-brand">
              {error}
            </p>
          )}
        </div>
      </Section>

      {storageGroups.map((group) =>
        byGroup(group).length === 0 ? null : (
          <Section key={group} title={group}>
            {byGroup(group).map((item) => (
              <StorageRow
                key={item.id}
                item={item}
                busy={busy === item.id || busy === 'all'}
                disabled={busy !== null}
                confirming={confirming === item.id}
                onClear={() => clear(item)}
                onCancel={() => setConfirming(null)}
              />
            ))}
          </Section>
        ),
      )}

      <Section
        title="Erase All App Data"
        footer={
          confirming === 'all' && (
            <Confirm
              action="Erase Everything"
              danger
              onConfirm={() => void act('all', () => window.storage.eraseAll())}
              onCancel={() => setConfirming(null)}
            >
              Toolkits, History, the download list, unfinished downloads, caches
              and settings are all deleted, and the app starts as if new. Files
              you saved stay where they are, but the app stops listing them.
            </Confirm>
          )
        }
      >
        <Row
          label="Start Afresh"
          note="Clears everything above except your saved files."
        >
          <button
            type="button"
            onClick={() => setConfirming('all')}
            disabled={busy !== null}
            className={`${softButton} text-brand`}
          >
            {busy === 'all' ? 'Erasing…' : 'Erase…'}
          </button>
        </Row>
      </Section>
    </>
  );
}

function StorageRow({
  item,
  busy,
  disabled,
  confirming,
  onClear,
  onCancel,
}: {
  item: StorageItem;
  busy: boolean;
  disabled: boolean;
  confirming: boolean;
  onClear: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">
            {item.name}
            <span className="font-normal text-ink-faint tabular-nums">
              {' '}
              · {formatBytes(item.size)}
              {item.files !== null &&
                ` · ${item.files} file${item.files === 1 ? '' : 's'}`}
            </span>
          </p>
          <p className="text-xs text-ink-soft">{item.description}</p>
          <p
            title={item.location}
            className="truncate font-mono text-[11px] text-ink-faint select-text"
          >
            {item.location}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {item.revealable && (
            <button
              type="button"
              onClick={() => void window.storage.reveal(item.id)}
              title={showLabel}
              aria-label={`${showLabel}: ${item.name}`}
              className={softButton}
            >
              Show
            </button>
          )}
          {item.clear && (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled || item.size === 0}
              className={softButton}
            >
              {busy ? 'Clearing…' : item.clear.label}
            </button>
          )}
        </div>
      </div>
      {confirming && item.clear?.confirm && (
        <Confirm
          action={item.clear.label.replace('…', '')}
          onConfirm={onClear}
          onCancel={onCancel}
        >
          {item.clear.confirm}
        </Confirm>
      )}
    </div>
  );
}

const mod = isMac ? '⌘' : 'Ctrl';
const shift = isMac ? '⇧' : 'Shift';

/** The app's shortcuts, as handled in AppShell's useShortcuts. Each
 *  shortcut is its keys in order, shown one key to a chip. */
const shortcutGroups: {
  title: string;
  keys: [string, string[]][];
}[] = [
  {
    title: 'Tabs',
    keys: [
      ['New Tab', [mod, 'T']],
      ['Close Tab', [mod, 'W']],
      ['Reopen Closed Tab', [shift, mod, 'T']],
      ['Back', [mod, '[']],
      ['Forward', [mod, ']']],
    ],
  },
  {
    title: 'Go To',
    keys: [
      ['Quick Search', [mod, 'P']],
      ['Home', [mod, 'H']],
      ['History', [mod, 'Y']],
      ['Settings', [mod, ',']],
    ],
  },
  {
    title: 'Window',
    keys: [['Show or Hide the Sidebar', [mod, '\\']]],
  },
];

/**
 * Each group under the usual section heading, then its shortcuts as rows,
 * the keys on the right as separate grey chips.
 */
function Shortcuts() {
  return (
    <>
      {shortcutGroups.map(({ title, keys }) => (
        <Section key={title} title={title}>
          {keys.map(([action, combo]) => (
            <Row key={action} label={action}>
              <kbd className="flex shrink-0 gap-1 font-sans">
                {combo.map((key) => (
                  <span
                    key={key}
                    className="grid h-5.5 min-w-5.5 place-items-center rounded-md bg-group px-1.5 text-[11px] font-medium text-ink-soft"
                  >
                    {key}
                  </span>
                ))}
              </kbd>
            </Row>
          ))}
        </Section>
      ))}
    </>
  );
}

function Updates() {
  const version = useAppVersion();
  const toolkits = useToolkits() ?? [];
  const external = useExternalTools();

  return (
    <Section
      title="Versions"
      footer={
        <Footnote>
          Toolkits update on their own schedule, separately from the app. Add,
          update or remove them in Toolkits. yt-dlp is yours: update it the way
          you installed it.
        </Footnote>
      }
    >
      <Row label="App">
        <Value>{version}</Value>
      </Row>
      {toolkits
        .filter((toolkit) => !toolkit.planned)
        .map((toolkit) => (
          <Row key={toolkit.id} label={`${toolkit.name} Toolkit`}>
            <Value>
              {toolkit.installed ? installedLine(toolkit) : 'Not installed'}
              {toolkit.updateAvailable ? ' · Update available' : ''}
            </Value>
          </Row>
        ))}
      {external?.ytdlp.found && (
        <Row label="yt-dlp (yours)">
          <Value>{external.ytdlp.found.version}</Value>
        </Row>
      )}
    </Section>
  );
}

function Changelog() {
  return (
    <>
      {changelog.map((release) => (
        <Section
          key={release.version}
          title={`Version ${release.version}`}
          footer={
            <Footnote>
              Released{' '}
              {
                // Local midnight, so the day doesn't shift with the time zone.
                new Date(`${release.date}T00:00`).toLocaleDateString(
                  undefined,
                  { dateStyle: 'long' },
                )
              }
            </Footnote>
          }
        >
          <ul className="flex flex-col gap-1.5">
            {release.changes.map((change) => (
              <li key={change} className="flex gap-2.5 text-[13px] text-ink">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-faint" />
                {change}
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}
