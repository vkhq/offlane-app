import { useEffect, useRef, useState } from 'react';

import { type Options, parseValues } from '../../shared/tools';
import type { FilePreview } from '../../shared/types';
import { X } from '../components/icons';
import { useDownloads } from '../downloads';
import { addActivity } from '../history';
import { configOf, tools } from '../tools';
import { useCanvas } from './Canvas';
import { Arrow, FlowNode } from './Flow';
import { noteToolJobs, useAllJobs, useConnected } from './jobs';
import { type MediaItem, MediaStrip } from './MediaStrip';
import { RunSection, runsLock } from './RunSection';
import type { OptionHints, StandardTool } from './standardTool';
import { StageContext, type Step, type StepInput, useSteps } from './steps';
import { iconButton } from './styles';

/** The gap between branches side by side, and half of it, in px. */
const branchGap = 'gap-16';
const halfGap = '-left-8';
const halfGapRight = '-right-8';

/**
 * The steps that branch from a stage (`parent`, or null for the page's
 * own), side by side under it in the order they were added, each with its
 * own branches under it. One hangs straight below; several fork from a
 * line across, rounded at its ends, an arrow down from it to each.
 */
export function Branches({ parent }: { parent: string | null }) {
  const steps = useSteps();
  const branches = steps?.steps.filter((step) => step.parent === parent) ?? [];
  if (branches.length === 0) return null;
  const fork = branches.length > 1;
  return (
    <div className="flex flex-col items-center">
      {fork && <span className="flow-line h-6 animate-grow-down" />}
      <div className={`flex items-start ${branchGap}`}>
        {branches.map((step, index) => {
          const first = index === 0;
          const last = index === branches.length - 1;
          return (
            <div key={step.id} className="relative flex flex-col items-center">
              {fork && (
                <span
                  aria-hidden
                  className={`absolute top-0 h-4 border-t-2 border-link ${
                    first
                      ? `left-[calc(50%-1px)] rounded-tl-[14px] border-l-2 ${halfGapRight}`
                      : last
                        ? `right-[calc(50%-1px)] rounded-tr-[14px] border-r-2 ${halfGap}`
                        : `${halfGap} ${halfGapRight}`
                  }`}
                />
              )}
              {/* From a rounded end, the arrow starts where its curve
                  ends, so it doesn't show through the curve. */}
              {fork && (first || last) ? (
                <div className="pt-4">
                  <Arrow length="h-6" />
                </div>
              ) : (
                <Arrow length="h-10" />
              )}
              <StepCard step={step} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One step: a tool run on an earlier stage's outputs, branching below it.
 * Its input is fixed, as it comes from that stage (with checkboxes, among
 * several, for which to run on); its options, button and results are its
 * own, and the steps that branch from it hang below.
 */
function StepCard({ step }: { step: Step }) {
  const steps = useSteps();
  const tool = tools.find((candidate) => candidate.id === step.toolId);
  const connected = useConnected(step.toolId);
  const allJobs = useAllJobs();
  const strip = useStripItems(step.inputs);
  const [config, setConfig] = useState<StandardTool<Options> | null>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState<OptionHints>({});
  const card = useRef<HTMLElement>(null);
  const canvas = useCanvas();

  useEffect(() => {
    if (!tool) return;
    let live = true;
    void configOf(tool).then((loaded) => live && setConfig(loaded));
    return () => {
      live = false;
    };
  }, [tool]);

  // A step just added is glided to once its form is there.
  const fresh = steps?.added === step.id;
  useEffect(() => {
    if (!fresh || !config) return;
    const frame = requestAnimationFrame(() => {
      if (card.current) canvas?.reveal(card.current, 'start');
    });
    return () => cancelAnimationFrame(frame);
  }, [fresh, config, canvas]);

  if (!steps || !tool) return null;
  const values = config ? parseValues(config.options, step.values) : null;
  // Of several inputs, those ticked; all of them once it has run, as
  // they were then. A tool with an editor works on one: the first not
  // left out.
  const skipped = step.skipped ?? [];
  const Editor = config?.editor;
  const only = step.inputs.findIndex((_, index) => !skipped.includes(index));
  const isChosen = (index: number) =>
    Editor ? index === only : !skipped.includes(index);
  const chosen = step.inputs.filter((_, index) => isChosen(index));
  // Run, what it ran on is a record (see runsLock).
  const ran = runsLock(
    step.jobIds.map((id) => allJobs.find((job) => job.id === id)),
  );
  const toggle = (index: number) =>
    steps.update(step.id, {
      skipped: Editor
        ? // Ticking one picks it in place of the other.
          step.inputs
            .map((_, other) => other)
            .filter((other) => other !== index)
        : skipped.includes(index)
          ? skipped.filter((other) => other !== index)
          : [...skipped, index],
    });

  const run = async () => {
    if (!config || !values) return;
    if (!connected) {
      setNotice(`${config.action} isn't connected yet.`);
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const jobs = await window.tools.run(tool.id, {
        files: [],
        links: [],
        outputs: chosen.map(({ source, jobId, index }) => ({
          source,
          jobId,
          index,
        })),
        values,
        attachments: step.attachments,
      });
      noteToolJobs(jobs);
      steps.update(step.id, {
        jobIds: [...jobs.map((job) => job.id), ...step.jobIds],
      });
      addActivity(
        tool.id,
        chosen.map((input) => ({ name: input.name, kind: 'file' })),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  // What it does to what, as a heading: "Compress" and the file's name,
  // the tool's name without the word for its input ("Compress Video" on a
  // video). A tool named otherwise keeps its name: "Replace Audio",
  // "Video to GIF".
  const nouns: Record<string, string> = {
    video: 'Videos?',
    audio: 'Audio',
    image: 'Images?',
    pdf: 'PDFs?',
    file: 'Files?',
  };
  const noun = nouns[step.inputs[0]?.kind ?? 'file'];
  const action =
    tool.name.replace(new RegExp(`\\s+(${noun})$`), '') || tool.name;
  const what =
    step.inputs.length === 1 || Editor
      ? (chosen[0] ?? step.inputs[0]).name
      : chosen.length === step.inputs.length
        ? `${step.inputs.length} files`
        : `${chosen.length} of ${step.inputs.length} files`;

  return (
    <StageContext value={step.id}>
      <div className="flex w-132 flex-col">
        <FlowNode
          ref={card}
          icon={tool.icon}
          title={action}
          detail={what}
          // Only until it has run: once under way or done it is part of
          // the workflow's record, like the stages before it.
          beside={
            !ran && (
              <button
                type="button"
                aria-label={`Remove ${tool.name} step`}
                title="Remove this step and the ones made from it"
                onClick={() => steps.remove(step.id)}
                className={iconButton}
              >
                <X size={14} />
              </button>
            )
          }
        >
          {/* What it works on, as every stage shows its files; with an
              editor, only to pick which, among several. */}
          {(!Editor || step.inputs.length > 1) && (
            <div className="rounded-2xl bg-canvas px-4 py-3 shadow-card">
              <MediaStrip
                // Sizes only where the tool is about them (see withSizes).
                items={
                  config?.input.kind === 'drop' && config.input.sizes
                    ? strip
                    : strip.map((item) => ({ ...item, size: undefined }))
                }
                ticked={isChosen}
                locked={ran}
                onToggle={toggle}
                verb={Editor ? 'Pick' : 'Use'}
              />
            </div>
          )}
          {Editor && values && chosen[0] && (
            <Editor
              key={`${chosen[0].jobId}:${chosen[0].index}`}
              media={{
                source: chosen[0].source,
                jobId: chosen[0].jobId,
                index: chosen[0].index,
              }}
              options={config.options}
              values={values}
              onChange={(patch) =>
                steps.update(step.id, { values: { ...step.values, ...patch } })
              }
              locked={ran}
              onHints={setHints}
            />
          )}
          {config === null && (
            <p className="px-1 text-[13px] text-ink-soft">
              {tool.name} can't be used as a step.
            </p>
          )}
        </FlowNode>
        {/* Its options, button and results, as on a tool's own page. */}
        {config && values && (
          <RunSection
            tool={tool}
            config={config}
            values={values}
            hints={Editor ? hints : undefined}
            onChange={(key, value) =>
              steps.update(step.id, {
                values: { ...step.values, [key]: value },
              })
            }
            onFile={(key, file) =>
              steps.update(step.id, {
                attachments: { ...step.attachments, [key]: file },
              })
            }
            count={chosen.length}
            kind={step.inputs[0]?.kind}
            locked={ran}
            // Nothing ticked: nothing to run.
            busy={busy || chosen.length === 0}
            notice={notice}
            onRun={() => void run()}
            ids={step.jobIds}
          />
        )}
      </div>
      <Branches parent={step.id} />
    </StageContext>
  );
}

/** A picture and length for each file a step can work on, by output. */
const previews = new Map<string, Promise<FilePreview | null>>();

/** An earlier output's picture and length: a download's thumbnail, or a
 *  frame of a tool's video. No picture for one without (audio, a PDF). */
function previewOf(input: StepInput) {
  const key = `${input.source}:${input.jobId}:${input.index}`;
  let found = previews.get(key);
  if (!found) {
    found = (
      input.source === 'download'
        ? window.downloader
            .preview(input.jobId)
            .then((thumbnail) => ({ thumbnail, duration: null }))
        : window.tools.preview(input.jobId)
    ).catch(() => null);
    previews.set(key, found);
  }
  return found;
}

/** A step's inputs as the strip shows them, their size (and a download's
 *  length) from the job that made them. */
function useStripItems(inputs: StepInput[]): MediaItem[] {
  const downloads = useDownloads();
  const runs = useAllJobs();
  return inputs.map((input) => ({
    key: `${input.source}:${input.jobId}:${input.index}`,
    name: input.name,
    kind: input.kind,
    duration:
      input.source === 'download'
        ? downloads.find((job) => job.id === input.jobId)?.duration
        : undefined,
    size:
      input.source === 'download'
        ? downloads.find((job) => job.id === input.jobId)?.fileSize
        : // A run's size is its first output's.
          input.index === 0
          ? runs.find((job) => job.id === input.jobId)?.outputSize
          : undefined,
    preview: () => previewOf(input),
  }));
}
