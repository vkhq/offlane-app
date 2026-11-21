import { useEffect, useState } from 'react';

import type { Options } from '../../shared/tools';
import { addActivity } from '../history';
import type { SavedFile, SessionStatus } from '../../shared/types';
import { useSession } from '../sessions';
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
};

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
    const { input, options, action } = config;
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
      if (!ready || locked) return;
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

    return (
      <ToolLayout tool={tool}>
        <FlowNode
          icon={step.icon}
          title={input.kind === 'link' ? input.label : step.title}
          detail={
            input.kind === 'drop' && count > 0
              ? `${count} ${count === 1 ? 'item' : 'items'}`
              : undefined
          }
          aside={(ready || own.length > 0) && <StartOver onClick={startOver} />}
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
          {input.kind === 'drop' && (
            <DropZone
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
