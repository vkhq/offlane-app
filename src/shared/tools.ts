// The contract between a tool's page and its back end. A tool's options are
// declared once (its options.ts), read by its page to draw the form and by
// its handler to validate what the page sent, so the two cannot drift.
// No Electron or React import: both processes use this file.

export type SelectSetting = {
  kind: 'select';
  label: string;
  options: string[];
  value: string;
};
export type ToggleSetting = { kind: 'toggle'; label: string; value: boolean };
export type NumberSetting = {
  kind: 'number';
  label: string;
  value: number;
  unit?: string;
};
export type SliderSetting = { kind: 'slider'; label: string; value: number };
export type TextSetting = {
  kind: 'text';
  label: string;
  value: string;
  placeholder?: string;
};
export type PasswordSetting = {
  kind: 'password';
  label: string;
  placeholder?: string;
};
export type FileSetting = { kind: 'file'; label: string; accept: string };
export type InfoSetting = { kind: 'info'; label: string; value: string };

export type Setting =
  | SelectSetting
  | ToggleSetting
  | NumberSetting
  | SliderSetting
  | TextSetting
  | PasswordSetting
  | FileSetting
  | InfoSetting;

export type SettingValue = string | number | boolean;

/** A tool's options, by key. The key, not the label, is what code reads. */
export type Options = Record<string, Setting>;

type ValueOf<S extends Setting> = S extends ToggleSetting
  ? boolean
  : S extends NumberSetting | SliderSetting
    ? number
    : string;

/** The values a tool's options hold, typed by each option's kind. */
export type OptionValues<O extends Options> = { [K in keyof O]: ValueOf<O[K]> };

/** Declares a tool's options; only here so the keys and kinds are inferred. */
export const defineOptions = <O extends Options>(options: O) => options;

const initialValue = (setting: Setting): SettingValue =>
  setting.kind === 'toggle'
    ? setting.value
    : 'value' in setting
      ? setting.value
      : '';

export const defaultValues = <O extends Options>(options: O) =>
  Object.fromEntries(
    Object.entries(options).map(([key, setting]) => [
      key,
      initialValue(setting),
    ]),
  ) as OptionValues<O>;

/**
 * Checks values sent from the page against the options, treating them as
 * untrusted: unknown keys are dropped, a missing or wrong-typed value falls
 * back to the option's default, and a select only takes one of its options.
 */
export function parseValues<O extends Options>(
  options: O,
  raw: unknown,
): OptionValues<O> {
  const input =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const values = defaultValues(options) as Record<string, SettingValue>;
  for (const [key, setting] of Object.entries(options)) {
    const value = input[key];
    switch (setting.kind) {
      case 'toggle':
        if (typeof value === 'boolean') values[key] = value;
        break;
      case 'number':
      case 'slider':
        if (typeof value === 'number' && Number.isFinite(value))
          values[key] = value;
        break;
      case 'select':
        if (typeof value === 'string' && setting.options.includes(value))
          values[key] = value;
        break;
      case 'info':
        // Fixed text, never chosen.
        break;
      default:
        if (typeof value === 'string' && value.length <= 4096)
          values[key] = value;
    }
  }
  return values as OptionValues<O>;
}

// Builders for the options most tools share.

export const select = (
  label: string,
  options: string[],
  value = options[0],
): SelectSetting => ({ kind: 'select', label, options, value });

export const toggle = (label: string, value = false): ToggleSetting => ({
  kind: 'toggle',
  label,
  value,
});

export const info = (label: string, value: string): InfoSetting => ({
  kind: 'info',
  label,
  value,
});

export const number = (
  label: string,
  value: number,
  unit?: string,
): NumberSetting => ({ kind: 'number', label, value, unit });

export const text = (
  label: string,
  value = '',
  placeholder?: string,
): TextSetting => ({ kind: 'text', label, value, placeholder });

export const password = (
  label: string,
  placeholder?: string,
): PasswordSetting => ({ kind: 'password', label, placeholder });

export const file = (label: string, accept: string): FileSetting => ({
  kind: 'file',
  label,
  accept,
});

export const quality = (value = 80): SliderSetting => ({
  kind: 'slider',
  label: 'Quality',
  value,
});

/** `start` and `end`, in seconds; spread into a tool's options. */
export const timeRange = () => ({
  start: number('Start', 0, 's'),
  end: number('End', 10, 's'),
});

export const pageRange = (label = 'Pages') => text(label, '', '1-3, 5');

export const widthPx = (value: string, options: string[]) =>
  select('Width', options, value);

export const languages = [
  'English (United States)',
  'English (United Kingdom)',
  'Spanish',
  'French',
  'German',
  'Hindi',
  'Japanese',
  'Chinese (Simplified)',
];

export const language = (label = 'Language') => select(label, languages);

// Running a tool.

/**
 * An earlier run's output, named by the job that wrote it rather than by its
 * path, which the page never sees. The main process looks the path up in its
 * own records: the tool queue's, or the download manager's.
 */
export type OutputRef = {
  source: 'tool' | 'download';
  jobId: string;
  /** Which of the job's outputs; downloads have one. */
  index: number;
};

/** What a page asks the back end to run, once files are paths. */
export type ToolRunRequest = {
  toolId: string;
  /** Absolute paths of the files the user added. */
  files: string[];
  links: string[];
  values: Record<string, unknown>;
};

export type ToolJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

/** One run of a tool on one input. */
export type ToolJob = {
  id: string;
  toolId: string;
  /** The file name or link it was run on. */
  input: string;
  status: ToolJobStatus;
  /** 0–100, or null while it cannot tell. */
  progress: number | null;
  /** Names of the files it wrote. */
  outputs: string[];
  /** The input file's size in bytes; unknown for a link. */
  inputSize?: number;
  /** Once done, the size of what it wrote, all its files together. */
  outputSize?: number;
  error?: string;
  createdAt: number;
};

/** What the preload exposes to the page as `window.tools`. */
export type ToolsApi = {
  /** The ids of the tools that have a back end. */
  connected: () => Promise<string[]>;
  /**
   * Starts one job per input. Files are the page's own File objects, or
   * files saved with a session, by reference.
   */
  run: (
    toolId: string,
    request: {
      files: (File | import('./types').SavedFile)[];
      links: string[];
      /** Earlier outputs to work on, as in a chain of steps. */
      outputs?: OutputRef[];
      values: Record<string, unknown>;
    },
  ) => Promise<ToolJob[]>;
  list: () => Promise<ToolJob[]>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reveal: (id: string) => Promise<void>;
  onJob: (cb: (job: ToolJob) => void) => () => void;
  onJobRemoved: (cb: (id: string) => void) => () => void;
};
