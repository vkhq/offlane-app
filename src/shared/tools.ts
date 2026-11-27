// The contract between a tool's page and its back end. A tool's options are
// declared once (its options.ts), read by its page to draw the form and by
// its handler to validate what the page sent, so the two cannot drift.
// No Electron or React import: both processes use this file.

/**
 * When an option is shown: only while another option (by key) has one of
 * these values. A hidden option is left out of the form and the summary,
 * and its handler gets its default value.
 */
export type Condition = { option: string; is: SettingValue[] };

export type SelectSetting = {
  kind: 'select';
  label: string;
  options: string[];
  value: string;
  /** The choice as a summary says it, when the value alone wouldn't say
   *  what it is ("English" → "English audio"); null leaves it out. */
  summary?: (value: string) => string | null;
  /** Shows the editor's words for the chosen value (see OptionHints) in
   *  the bar too, after it: Extract Audio's "Original (M4A)". */
  hintInBar?: boolean;
};
export type ToggleSetting = { kind: 'toggle'; label: string; value: boolean };
export type NumberSetting = {
  kind: 'number';
  label: string;
  value: number;
  unit?: string;
  /** Seconds, shown and typed as a time ("1:05.25"), not a number. */
  time?: boolean;
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
/**
 * A whole number a tool's editor sets on the file, in pixels of the
 * picture as it plays (a crop box's edge): sent to the handler, but never
 * shown in the options bar or the summary, and not reset for being out of
 * the bar. Kept within `min` and `max`; the handler still keeps it within
 * the picture, as the file may not be the one it was set on.
 */
export type EditorSetting = {
  kind: 'editor';
  /** What it is, for anyone reading the code or a saved tab. */
  label: string;
  value: number;
  min: number;
  max: number;
};
/**
 * A list of whole numbers a tool's editor picks on the file (Extract
 * Audio's tracks), held as text, "0,2", so it saves and restores as any
 * other value does. Like `EditorSetting`, sent to the handler but never in
 * the options bar or the summary. Checked as untrusted: anything but
 * comma-separated whole numbers falls back to its default. The handler
 * still checks each number against the file, which may not be the one it
 * was picked on.
 */
export type EditorListSetting = {
  kind: 'editorList';
  /** What it is, for anyone reading the code or a saved tab. */
  label: string;
  value: string;
};

export type Setting = (
  | SelectSetting
  | ToggleSetting
  | NumberSetting
  | SliderSetting
  | TextSetting
  | PasswordSetting
  | FileSetting
  | InfoSetting
  | EditorSetting
  | EditorListSetting
) & { when?: Condition };

export type SettingValue = string | number | boolean;

/** A tool's options, by key. The key, not the label, is what code reads. */
export type Options = Record<string, Setting>;

type ValueOf<S extends Setting> = S extends ToggleSetting
  ? boolean
  : S extends NumberSetting | SliderSetting | EditorSetting
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

/** Whether option `key` is shown, given the values chosen so far. */
export function isShown(
  options: Options,
  key: string,
  values: Record<string, unknown>,
): boolean {
  const when = options[key]?.when;
  return !when || when.is.includes(values[when.option] as SettingValue);
}

/**
 * Whether option `key` is one the options bar and the summary show: shown
 * (see `isShown`), and not one an editor sets.
 */
export const inBar = (
  options: Options,
  key: string,
  values: Record<string, unknown>,
) => {
  const kind = options[key]?.kind;
  return (
    kind !== 'editor' && kind !== 'editorList' && isShown(options, key, values)
  );
};

/** `setting`, shown only while option `option` is one of `is`. */
export const shownWhen = <S extends Setting>(
  setting: S,
  option: string,
  is: SettingValue[],
): S => ({ ...setting, when: { option, is } });

/**
 * Checks values sent from the page against the options, treating them as
 * untrusted: unknown keys are dropped, a missing or wrong-typed value falls
 * back to the option's default, a select only takes one of its options, an
 * editor's value is rounded and kept within its range, and a hidden option
 * (see `Condition`) keeps its default.
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
      case 'editor':
        if (typeof value === 'number' && Number.isFinite(value)) {
          values[key] = Math.min(
            setting.max,
            Math.max(setting.min, Math.round(value)),
          );
        }
        break;
      case 'editorList':
        if (typeof value === 'string' && value.length <= 1024) {
          const list = parseList(value);
          if (list) values[key] = formatList(list);
        }
        break;
      case 'info':
        // Fixed text, never chosen.
        break;
      default:
        if (typeof value === 'string' && value.length <= 4096)
          values[key] = value;
    }
  }
  const defaults = defaultValues(options) as Record<string, SettingValue>;
  for (const key of Object.keys(options)) {
    if (!isShown(options, key, values)) values[key] = defaults[key];
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

/**
 * A number of pixels a tool's editor sets (see `EditorSetting`), from
 * `value`, kept within 0 and 8192 unless told otherwise.
 */
export const editorValue = (
  label: string,
  value = 0,
  { min = 0, max = 8192 }: { min?: number; max?: number } = {},
): EditorSetting => ({ kind: 'editor', label, value, min, max });

/**
 * A list of whole numbers a tool's editor picks (see `EditorListSetting`),
 * from `value`; empty, none picked, unless told otherwise.
 */
export const editorList = (label: string, value = ''): EditorListSetting => ({
  kind: 'editorList',
  label,
  value,
});

/** An editor list's numbers ("2,0,2" → [0, 2]: in order, each once), or
 *  null if it isn't one. "" is the empty list. */
export function parseList(value: string): number[] | null {
  if (value === '') return [];
  if (!/^\d{1,4}(,\d{1,4})*$/.test(value)) return null;
  return [...new Set(value.split(',').map(Number))].sort((a, b) => a - b);
}

/** Numbers as an editor list holds them: [0, 2] → "0,2". */
export const formatList = (numbers: number[]) =>
  [...new Set(numbers)].sort((a, b) => a - b).join(',');

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

/** A moment, in seconds, shown and typed as a time. */
export const time = (label: string, value: number): NumberSetting => ({
  kind: 'number',
  label,
  value,
  time: true,
});

/** `start` and `end`, in seconds; spread into a tool's options. */
export const timeRange = () => ({
  start: time('Start', 0),
  end: time('End', 10),
});

/** Seconds to the hundredth, as times are shown: "1:05.25", "1:02:05.25". */
export function clock(seconds: number) {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  const total = Math.floor(hundredths / 100);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  const cs = String(hundredths % 100).padStart(2, '0');
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${s}.${cs}`
    : `${m}:${s}.${cs}`;
}

/**
 * A time as typed, in seconds: "1:05.25", "1:02:05", "65.5" or "65.5s";
 * null if it isn't one. Minutes and seconds after a colon are under 60.
 */
export function parseClock(text: string): number | null {
  const typed = text.trim().replace(/s$/i, '').trim();
  if (!/^\d+(:\d+){0,2}(\.\d+)?$|^\.\d+$/.test(typed)) return null;
  const parts = typed.split(':').map(Number);
  if (parts.slice(1).some((part) => part >= 60)) return null;
  const seconds = parts.reduce((sum, part) => sum * 60 + part, 0);
  return Number.isFinite(seconds) ? Math.round(seconds * 100) / 100 : null;
}

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
  /** Once done, anything the person should know about the result. */
  note?: string;
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
      /** The file chosen for each file option, by the option's key. */
      attachments?: Record<string, File | import('./types').SavedFile>;
    },
  ) => Promise<ToolJob[]>;
  /**
   * Saves a recording made in the page (MediaRecorder's bytes and MIME
   * type); the result goes to `run` as one of its files.
   */
  saveRecording: (
    data: ArrayBuffer,
    type: string,
  ) => Promise<import('./types').SavedFile>;
  list: () => Promise<ToolJob[]>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Shows a finished job's output in Finder: its `index`th (the first by
   *  default), for a job that made several. */
  reveal: (id: string, index?: number) => Promise<void>;
  /** Opens a finished job's output in the computer's own app for it. */
  open: (id: string, index?: number) => Promise<void>;
  /** A frame of a finished job's video output, and its length; nothing
   *  for one that isn't a video, or can't be read. */
  preview: (id: string) => Promise<import('./types').FilePreview>;
  /** Readies a finished job's output to play in the app, with audio
   *  track `audioTrack` (the first by default). */
  preparePlayback: (
    id: string,
    audioTrack?: number,
  ) => Promise<import('./types').PlaybackSource>;
  cancelPlayback: (id: string) => Promise<void>;
  onPlaybackProgress: (
    cb: (progress: import('./types').PlaybackProgress) => void,
  ) => () => void;
  onJob: (cb: (job: ToolJob) => void) => () => void;
  onJobRemoved: (cb: (id: string) => void) => () => void;
  /**
   * Runs a tool on an editor's file as a preview of what it will make (only
   * a tool whose handler `previews`): nothing is listed or saved, and the
   * file comes back as bytes. `id` names this preview, so it can be stopped
   * (cancelPreview, or another makePreview with the same id) and its
   * progress told apart. Rejects with "Cancelled" once stopped.
   */
  makePreview: (
    id: string,
    toolId: string,
    media: import('./types').MediaRef,
    values: Record<string, unknown>,
  ) => Promise<ToolPreview>;
  cancelPreview: (id: string) => Promise<void>;
  onPreviewProgress: (cb: (progress: PreviewProgress) => void) => () => void;
  /** A finished job's GIF, as bytes, for the app's GIF player. */
  gifBytes: (id: string) => Promise<Uint8Array>;
};

/** A tool's preview (see ToolsApi.makePreview): the file it would make. */
export type ToolPreview = {
  bytes: Uint8Array;
  /** Its size in bytes, as it would be saved. */
  size: number;
  /** The handler's note, as a run would show it. */
  note?: string;
};

/** How far a preview has got: 0–100, or null while it can't tell. */
export type PreviewProgress = { id: string; percent: number | null };
