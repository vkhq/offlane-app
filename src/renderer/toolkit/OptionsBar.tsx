import { Fragment, useRef } from 'react';

import {
  type OptionValues,
  type Options,
  type Setting,
  type SettingValue,
  isShown,
} from '../../shared/tools';
import { ArrowRight, Check, ChevronDown } from '../components/icons';
import { SelectMenu } from './SelectMenu';

/**
 * A tool's options in one rounded bar, split by hairlines, with its action
 * at the right end: each option is a segment showing its value, and picks
 * from a menu, flips, or takes a short entry in place. `disabled` shrinks it
 * to a small summary of the choices made, once a step has run.
 * With no options, the action is the bar.
 */
export function OptionsBar<O extends Options>({
  options,
  values,
  onChange,
  onFile,
  action,
  onRun,
  busy = false,
  disabled = false,
}: {
  options: O;
  values: OptionValues<O>;
  onChange: (key: keyof O & string, value: SettingValue) => void;
  /** The file picked for a file option; its name goes to `onChange`. */
  onFile?: (key: keyof O & string, file: File) => void;
  action: string;
  onRun: () => void;
  /** Holds the action while a run is starting. */
  busy?: boolean;
  disabled?: boolean;
}) {
  // Only the options the choices made so far call for.
  const entries = Object.entries(options).filter(([key]) =>
    isShown(options, key, values),
  );
  const run = (
    <button
      type="button"
      disabled={busy}
      onClick={onRun}
      className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:cursor-default disabled:opacity-40"
    >
      {action}
      <ArrowRight size={14} />
    </button>
  );
  if (entries.length === 0) return disabled ? null : run;
  if (disabled) return <Summary options={options} values={values} />;

  return (
    <div className="flex h-11 max-w-full items-center rounded-full bg-well p-1">
      {/* Scrolls sideways when the options don't fit, fading out under
          the action so it shows there is more. */}
      <div className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto pl-2 [mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)]">
        {entries.map(([key, setting], index) => (
          <Fragment key={key}>
            {index > 0 && (
              <span aria-hidden className="h-4 w-px shrink-0 bg-ink/15" />
            )}
            <Segment
              setting={setting}
              value={values[key]}
              disabled={disabled}
              onChange={(value) => onChange(key, value)}
              onFile={(file) => onFile?.(key, file)}
            />
          </Fragment>
        ))}
      </div>
      {!disabled && <div className="pl-1">{run}</div>}
    </div>
  );
}

/**
 * The choices made, once a step has run: a small centred pill, sized to its
 * text, under the link's arrow, in place of the full-width bar. Toggles that
 * are off and empty or secret fields are left out.
 */
function Summary<O extends Options>({
  options,
  values,
}: {
  options: O;
  values: OptionValues<O>;
}) {
  const parts = summarizeOptions(options, values);
  if (parts.length === 0) return null;

  return (
    <p
      aria-label={`Options: ${parts.join(', ')}`}
      className="flex h-8 max-w-full items-center gap-2 self-center rounded-full bg-canvas px-3.5 text-[13px] font-medium text-ink shadow-node"
    >
      <Check size={13} strokeWidth={2.5} className="shrink-0 text-link" />
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span aria-hidden className="text-ink-faint">
              ·
            </span>
          )}
          <span className="truncate">{part}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** The choices made, as the summary and History show them. */
export function summarizeOptions<O extends Options>(
  options: O,
  values: OptionValues<O>,
) {
  return Object.entries(options)
    .filter(([key]) => isShown(options, key, values))
    .map(([key, setting]) => summarize(setting, values[key]))
    .filter((part): part is string => Boolean(part));
}

/** One choice as the summary shows it, or null to leave it out. */
function summarize(setting: Setting, value: SettingValue): string | null {
  switch (setting.kind) {
    case 'select':
    case 'info':
      return String(setting.kind === 'info' ? setting.value : value) || null;
    case 'slider':
      return `${setting.label} ${value}%`;
    case 'toggle':
      return value ? setting.label : null;
    case 'number':
      return `${setting.label} ${value}${setting.unit ?? ''}`;
    case 'text':
    case 'file':
      return String(value) || null;
    default:
      return null;
  }
}

const segment =
  'relative flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium whitespace-nowrap';
const live = 'cursor-pointer';

/** Fields inside a segment: bare, underlined only while typed in. */
const field =
  'h-6 bg-transparent text-ink outline-none select-text placeholder:text-ink-faint focus:underline';

function Segment({
  setting,
  value,
  disabled,
  onChange,
  onFile,
}: {
  setting: Setting;
  value: SettingValue;
  disabled: boolean;
  onChange: (value: SettingValue) => void;
  onFile: (file: File) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);

  switch (setting.kind) {
    case 'select':
    case 'slider': {
      // A slider picks from tens, keeping its own value if it is between.
      const choices =
        setting.kind === 'select'
          ? setting.options.map((option) => [option, option])
          : [...new Set([...tens, Number(value)])]
              .sort((a, b) => b - a)
              .map((option) => [String(option), `${option}%`]);
      const shown =
        setting.kind === 'slider' ? `${setting.label} ${value}%` : value;
      return (
        <SelectMenu
          label={setting.label}
          value={String(value)}
          choices={choices as [string, string][]}
          disabled={disabled}
          onChange={(chosen) =>
            onChange(setting.kind === 'slider' ? Number(chosen) : chosen)
          }
          className={`${segment} ${disabled ? 'text-ink-soft' : live}`}
        >
          {shown}
          {!disabled && (
            <ChevronDown size={12} className="shrink-0 text-ink-faint" />
          )}
        </SelectMenu>
      );
    }
    case 'toggle':
      // On, it reads as chosen, with a tick; off, it fades back.
      return (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          disabled={disabled}
          onClick={() => onChange(!value)}
          className={`${segment} ${disabled ? '' : live} ${
            value ? 'text-ink' : 'text-ink-faint'
          }`}
        >
          {value && <Check size={12} strokeWidth={2.5} />}
          {setting.label}
        </button>
      );
    case 'number':
      return (
        <label className={`${segment} text-ink-soft`}>
          {setting.label}
          <input
            type="number"
            min={0}
            disabled={disabled}
            aria-label={setting.label}
            value={Number(value)}
            onChange={(event) => onChange(Number(event.target.value))}
            className={`${field} w-10 text-right`}
          />
          {setting.unit}
        </label>
      );
    case 'text':
    case 'password':
      return (
        <label className={segment}>
          <input
            type={setting.kind}
            disabled={disabled}
            aria-label={setting.label}
            value={String(value)}
            placeholder={setting.placeholder ?? setting.label}
            onChange={(event) => onChange(event.target.value)}
            className={`${field} w-28`}
          />
        </label>
      );
    case 'file':
      return (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() => picker.current?.click()}
            className={`${segment} ${disabled ? '' : live} ${
              value ? '' : 'text-ink-soft'
            }`}
          >
            <span className="max-w-32 truncate">
              {String(value) || `${setting.label}…`}
            </span>
          </button>
          <input
            ref={picker}
            type="file"
            hidden
            accept={setting.accept}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) {
                onFile(chosen);
                onChange(chosen.name);
              }
              event.target.value = '';
            }}
          />
        </>
      );
    case 'info':
      return (
        <span
          title={`${setting.label}: ${setting.value}`}
          className={`${segment} text-ink-soft`}
        >
          {setting.value}
        </span>
      );
    default:
      return null;
  }
}

const tens = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
