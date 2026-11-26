import { type ComponentType, useEffect, useState } from 'react';

import type { Options, OptionValues, SettingValue } from '../../shared/tools';
import { addActivity } from '../history';
import type { MediaRef, SavedFile, SessionStatus } from '../../shared/types';
import { savedFileOf, useSession } from '../sessions';
import { useTabState } from '../tabState';
import { CloudUpload, Link2, Mic } from '../components/icons';
import { DropZone, type Item } from './DropZone';
import { ClearButton, FlowNode, FlowNotice, StartOver } from './Flow';
import type { Input } from './inputs';
import { JobResults } from './JobList';
import { RunSection, runsLock } from './RunSection';
import { pastTense } from './verbs';
import { isToolJobGone, noteToolJobs, useAllJobs, useConnected } from './jobs';
import { LinkField } from './LinkField';
import { invalidLink, toLink } from './links';
import { summarizeOptions } from './OptionsBar';
import { Recorder, formatClock, useRecording } from './Recorder';
import { ToolLayout } from './ToolLayout';
import type { ToolPage } from './types';
import { useToolForm } from './useToolForm';

/** A standard tool's page, carrying the config it was made from. */
export type StandardToolPage = ToolPage & { config: StandardTool<Options> };

/** How a standard tool's page is laid out and what its button says. */
export type StandardTool<O extends Options> = {
  input: Input;
  options: O;
  /** Label of the action button. */
  action: string;
  /**
   * Shown in place of the file once one is added, to set the options on
   * it by hand, as Trim Video's timeline sets Start and End (see
   * TrimEditor). A tool with an editor works on one file at a time, on its
   * own page and as a later step.
   */
  editor?: ComponentType<ToolEditorProps>;
  /**
   * A step after the options showing what the tool will make, before it is
   * run, as Video to GIF's "GIF Preview" shows the GIF (its handler must
   * `preview`). For a tool with an editor, on the file it shows; gone
   * once the tool has run, as the result is then there to see.
   */
  preview?: { label: string; view: ComponentType<ToolPreviewProps> };
  /**
   * Why the tool can't run with these values, or null when it can: the
   * button is held and the reason shown under it, as Clean Up Audio does
   * with every cleaning step turned off.
   */
  blocked?: (values: OptionValues<O>) => string | null;
};

/** What a tool's preview step (see StandardTool.preview) is given. */
export type ToolPreviewProps = {
  toolId: string;
  /** The file the editor shows. */
  media: MediaRef;
  /** The tool's option values, as they would be run. */
  values: Record<string, SettingValue>;
};

/**
 * Words an editor adds to an option's choices, by option key and then by
 * choice, from what it knows of the file: Resize Video's "→ 608 × 1080"
 * beside a size a portrait video only fits inside.
 */
export type OptionHints = Record<string, Record<string, string>>;

/** What a tool's editor (see StandardTool.editor) is given. */
export type ToolEditorProps = {
  /** The file it works on, once the main process knows it. */
  media: MediaRef | null;
  /** The tool's options, for the choices it works with. */
  options: Options;
  /** The tool's option values, which it shows and sets. */
  values: Record<string, SettingValue>;
  /** Sets some of the options at once. */
  onChange: (patch: Record<string, SettingValue>) => void;
  /** Run: shown as the record of what was done, not changed. */
  locked: boolean;
  /** Sets the words shown beside the options' choices (see OptionHints). */
  onHints: (hints: OptionHints) => void;
};

/** A dropped or picked file as an editor names it: by its token. */
function useMediaRef(item: Item | undefined): MediaRef | null {
  const [ref, setRef] = useState<MediaRef | null>(null);
  useEffect(() => {
    setRef(null);
    if (!item || typeof item === 'string') return;
    let live = true;
    savedFileOf(item)
      .then((saved) => live && setRef({ source: 'file', token: saved.token }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [item]);
  return ref;
}

const inputSteps = {
  drop: { title: 'Add Files', icon: CloudUpload },
  link: { title: 'Link', icon: Link2 },
  record: { title: 'Recording', icon: Mic },
} as const;

/**
 * The page most tools use, as a workflow: what to work on (files, a link or
 * a recording); once there is something, the tool's options and its action;
 * once it has run, the results, each with the tools it can go on to. A tool
 * with no handler yet says so. Its files, link, options and runs are kept
 * with the tab; a recording is not, as it stops when its tab is left.
 */
export function standardTool<O extends Options>(
  config: StandardTool<O>,
): StandardToolPage {
  const page: ToolPage = function StandardToolPage({ tool }) {
    const { input, options, action, editor: Editor } = config;
    const [values, setValue] = useToolForm(options);
    const [items, setItems] = useTabState<Item[]>('items', []);
    /** The file picked for each file option, kept with the tab (sessions
     *  save Files by reference). */
    const [attachments, setAttachments] = useTabState<
      Record<string, File | SavedFile>
    >('attachments', {});
    const [link, setLink] = useTabState('link', '');
    const [notice, setNotice] = useTabState('notice', '');
    const [busy, setBusy] = useState(false);
    const [hints, setHints] = useState<OptionHints>({});
    /** The runs started from this tab: the workflow's results. */
    const [own, setOwn] = useTabState<string[]>('jobs', []);
    const recording = useRecording();
    const connected = useConnected(tool.id);
    const allJobs = useAllJobs();
    // How each of its runs stands, for History; one not yet heard of has
    // only just started.
    // A run removed from the list is no longer this workflow's: it drops
    // out of the results and of how its session stands.
    const kept = own.filter((id) => !isToolJobGone(id));
    useEffect(() => {
      if (kept.length !== own.length) setOwn(kept);
    });
    const runs: Record<string, SessionStatus> = Object.fromEntries(
      kept.map((id) => {
        const job = allJobs.find((candidate) => candidate.id === id);
        const status = job?.status ?? 'running';
        return [id, status === 'queued' ? 'running' : status];
      }),
    );
    // Saved to History from its first action on: files added, or a link
    // run. A recording isn't kept, so a recording tool has no session to
    // open again.
    const session = useSession(
      tool.id,
      () => {
        if (input.kind === 'record') return null;
        const first = input.kind === 'link' ? link : items[0];
        if (!first) return null;
        const name =
          typeof first === 'string'
            ? first.replace(/^https?:\/\//, '')
            : first.name;
        const count = input.kind === 'drop' ? items.length : 1;
        return {
          title: count > 1 ? `${name} and ${count - 1} more` : name,
          summary: summarizeOptions(options, values).join(' · '),
          preview: items.find((item) => typeof item !== 'string') ?? null,
          jobs: runs,
          doing: 'In progress',
          done: pastTense(action),
        };
      },
      Object.values(runs).join(),
    );

    // Run, what it ran on is part of its record (see runsLock).
    const locked = runsLock(
      kept.map((id) => allJobs.find((job) => job.id === id)),
    );

    const ready =
      input.kind === 'drop'
        ? items.length > 0
        : input.kind === 'link'
          ? link.trim().length > 0
          : recording.state === 'done' && recording.file !== null;

    const record = () =>
      addActivity(
        tool.id,
        input.kind === 'record'
          ? [
              {
                name: `Recording (${formatClock(recording.seconds)})`,
                kind: 'recording',
              },
            ]
          : input.kind === 'link'
            ? [{ name: link, kind: 'link' }]
            : items.map((item) =>
                typeof item === 'string'
                  ? { name: item, kind: 'link' }
                  : { name: item.name, kind: 'file', size: item.size },
              ),
      );

    const run = async () => {
      if (!ready || locked || config.blocked?.(values)) return;
      const links =
        input.kind === 'link'
          ? [toLink(link)]
          : items.filter((item) => typeof item === 'string');
      if (links.includes(null)) return setNotice(invalidLink);
      session.record();
      if (!connected) {
        setNotice(`${action} isn't connected yet.`);
        return record();
      }
      setBusy(true);
      try {
        const jobs = await window.tools.run(tool.id, {
          files:
            input.kind === 'record'
              ? recording.file
                ? [recording.file]
                : []
              : items.filter((item) => typeof item !== 'string'),
          links: links as string[],
          values,
          attachments,
        });
        noteToolJobs(jobs);
        record();
        setOwn((current) => [...jobs.map((job) => job.id), ...current]);
        setNotice('');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    };

    const startOver = () => {
      session.reset();
      setItems([]);
      setLink('');
      recording.reset();
      setNotice('');
      setOwn([]);
      setAttachments({});
    };

    const step = inputSteps[input.kind];
    const count = items.length;
    // A tool with an editor shows it in place of its one file.
    const editing = Editor && typeof items[0] === 'object' ? items[0] : null;
    const media = useMediaRef(editing ?? undefined);
    const startOverShown = ready || own.length > 0;
    // An empty drop zone says what it wants itself, so its step has no
    // label row until something is added (or Start Over has work to clear).
    const bare = input.kind === 'drop' && count === 0 && !startOverShown;

    return (
      <ToolLayout tool={tool} wide={!!Editor}>
        <FlowNode
          icon={step.icon}
          title={
            bare ? undefined : input.kind === 'link' ? input.label : step.title
          }
          detail={
            input.kind === 'drop' && count > 0
              ? editing
                ? editing.name
                : `${count} ${count === 1 ? 'item' : 'items'}`
              : undefined
          }
          aside={startOverShown && <StartOver onClick={startOver} />}
        >
          {input.kind === 'link' && (
            <LinkField
              input={input}
              value={link}
              onChange={(value) => {
                setLink(value);
                setNotice('');
              }}
              onSubmit={() => void run()}
              readOnly={locked}
              trailing={
                link &&
                !locked && (
                  <ClearButton
                    onClick={() => {
                      setLink('');
                      setNotice('');
                    }}
                  />
                )
              }
            />
          )}
          {input.kind === 'drop' && Editor && editing && (
            <Editor
              media={media}
              options={options}
              values={values}
              onChange={(patch) => {
                for (const [key, value] of Object.entries(patch)) {
                  setValue(key as keyof typeof options & string, value);
                }
              }}
              locked={locked}
              onHints={setHints}
            />
          )}
          {input.kind === 'drop' && !editing && (
            <DropZone
              single={!!Editor}
              input={input}
              items={items}
              locked={locked}
              onItemsChange={(next) => {
                setItems(next);
                // Adding files starts the session, and puts it in the URL.
                if (next.length > items.length) session.record();
              }}
              link={link}
              onLinkChange={setLink}
              onNotice={setNotice}
            />
          )}
          {input.kind === 'record' && (
            <Recorder input={input} recording={recording} locked={locked} />
          )}
          {!ready && <FlowNotice>{notice || recording.error}</FlowNotice>}
        </FlowNode>

        {/* Its options, button and results: the same on every tool's page
            and every later step (see RunSection). */}
        {ready && (
          <RunSection
            tool={tool}
            config={config}
            values={values}
            hints={editing ? hints : undefined}
            onChange={setValue}
            onFile={(key, file) =>
              setAttachments((current) => ({ ...current, [key]: file }))
            }
            count={input.kind === 'drop' ? items.length : undefined}
            kind={input.kind === 'drop' ? input.files : undefined}
            locked={locked}
            busy={busy}
            notice={notice}
            onRun={() => void run()}
            ids={own}
            media={media}
          />
        )}
        {!ready && <JobResults toolId={tool.id} ids={own} action={action} />}
      </ToolLayout>
    );
  };
  // Kept with the page, so a step in a chain can show the same form.
  return Object.assign(page, { config: config as StandardTool<Options> });
}

/** Past tenses of the verbs tools' buttons start with. */
