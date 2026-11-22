// Everything a tool's manifest.ts and page.tsx use, in one place, so a tool
// folder imports from here and not from around the app. Renderer only: a
// handler.ts imports from ./backend instead.
export * from '../renderer/components/icons';
export { ToolLayout } from '../renderer/toolkit/ToolLayout';
// The canvas a tool page is drawn on: `reveal` glides something into view.
export { useCanvas } from '../renderer/toolkit/Canvas';
export {
  ClearButton,
  FlowLink,
  FlowNode,
  FlowNotice,
  GoButton,
  StartOver,
  StepsFollow,
} from '../renderer/toolkit/Flow';
export { DropZone, type Item } from '../renderer/toolkit/DropZone';
export { LinkField } from '../renderer/toolkit/LinkField';
export {
  Recorder,
  type RecordState,
  type Recording,
  formatClock,
  useRecording,
  useStopwatch,
} from '../renderer/toolkit/Recorder';
export { OptionsBar, summarizeOptions } from '../renderer/toolkit/OptionsBar';
export { useSession } from '../renderer/sessions';
export { JobResults, runStatus } from '../renderer/toolkit/JobList';
export { NextStepNode, NextSteps } from '../renderer/toolkit/NextSteps';
export type { StepInput } from '../renderer/toolkit/steps';
export {
  isToolJobGone,
  useConnected,
  useToolJobs,
} from '../renderer/toolkit/jobs';
export { useToolForm } from '../renderer/toolkit/useToolForm';
export { invalidLink, toLink } from '../renderer/toolkit/links';
export * from '../renderer/toolkit/inputs';
export * as styles from '../renderer/toolkit/styles';
export {
  standardTool,
  type ToolEditorProps,
} from '../renderer/toolkit/standardTool';
export { TrimEditor } from '../renderer/toolkit/TrimEditor';
export {
  defineTool,
  type Tool,
  type ToolPage,
  type ToolPageProps,
} from '../renderer/toolkit/types';
export { ProgressBar } from '../renderer/components/ProgressBar';
export { useTabState } from '../renderer/tabState';
export {
  formatBytes,
  isDownloadGone,
  noteDownloads,
  useDownloads,
} from '../renderer/downloads';
export { useToolkit } from '../renderer/toolkits';
export { addActivity } from '../renderer/history';

// The in-app player, for a finished download or a tool's output.
export {
  PlayerModal,
  downloadFile,
  toolFile,
  type PlayerFile,
} from '../renderer/toolkit/PlayerModal';

// A round checkbox for picking among thumbnails.
export { RoundCheckbox } from '../renderer/toolkit/RoundCheckbox';

// Results: the section every tool's and download's results show in, and
// their card. Tools using standardTool get these without asking.
export {
  ResultCard,
  clock,
  revealLabel,
  type Playable,
} from '../renderer/toolkit/ResultCard';
export { Results, type ResultItem } from '../renderer/toolkit/Results';
