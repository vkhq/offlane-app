import { useEffect, useRef, useState } from 'react';

import { type Options, parseValues } from '../../shared/tools';
import { X } from '../components/icons';
import { addActivity } from '../history';
import { configOf, tools } from '../tools';
import { FlowLink, FlowNode, FlowNotice } from './Flow';
import { noteToolJobs, useConnected } from './jobs';
import { JobResults } from './JobList';
import { OptionsBar } from './OptionsBar';
import type { StandardTool } from './standardTool';
import { type Step, useSteps } from './steps';
import { iconButton } from './styles';
import { progressive } from './verbs';

/** Every step on the page, in the order they were added. */
export function StepList() {
  const steps = useSteps();
  if (!steps || steps.steps.length === 0) return null;
  return (
    <>
      {steps.steps.map((step) => (
        <StepCard key={step.id} step={step} />
      ))}
    </>
  );
}

/**
 * One step: a tool run on earlier outputs, further down the workflow it
 * started from. Its input is fixed, as it comes from an earlier step; its
 * options, button and results are its own.
 */
function StepCard({ step }: { step: Step }) {
  const steps = useSteps();
  const tool = tools.find((candidate) => candidate.id === step.toolId);
  const connected = useConnected(step.toolId);
  const [config, setConfig] = useState<StandardTool<Options> | null>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!tool) return;
    let live = true;
    void configOf(tool).then((loaded) => live && setConfig(loaded));
    return () => {
      live = false;
    };
  }, [tool]);

  // A step just added is scrolled to once its form is there.
  const fresh = steps?.added === step.id;
  useEffect(() => {
    if (fresh && config) {
      card.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [fresh, config]);

  if (!steps || !tool) return null;
  const values = config ? parseValues(config.options, step.values) : null;

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
        outputs: step.inputs.map(({ source, jobId, index }) => ({
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
        step.inputs.map((input) => ({ name: input.name, kind: 'file' })),
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
    step.inputs.length === 1
      ? step.inputs[0].name
      : `${step.inputs.length} files`;

  return (
    <>
      <FlowLink />
      <FlowNode
        ref={card}
        icon={tool.icon}
        title={action}
        detail={what}
        aside={
          <button
            type="button"
            aria-label={`Remove ${tool.name} step`}
            title="Remove this step and the ones made from it"
            onClick={() => steps.remove(step.id)}
            className={iconButton}
          >
            <X size={14} />
          </button>
        }
      >
        {config === null && (
          <p className="px-1 text-[13px] text-ink-soft">
            {tool.name} can't be used as a step.
          </p>
        )}
        {config && values && (
          <OptionsBar
            options={config.options}
            values={values}
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
            action={config.action}
            busy={busy}
            onRun={() => void run()}
          />
        )}
        <FlowNotice>{notice}</FlowNotice>
      </FlowNode>
      <JobResults
        toolId={tool.id}
        ids={step.jobIds}
        verb={config ? progressive(config.action) : undefined}
      />
    </>
  );
}
