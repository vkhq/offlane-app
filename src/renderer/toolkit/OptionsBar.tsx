import { useEffect, useRef, useState } from 'react';

import {
  type OptionValues,
  type Options,
  type Setting,
  type SettingValue,
  clock,
  isShown,
  parseClock,
} from '../../shared/tools';
import { ArrowRight, ChevronDown } from '../components/icons';
import { FlowLink } from './Flow';
import { SelectMenu } from './SelectMenu';

/**
 * A tool's options and its action. The options are a menu bar, as macOS
 * has: each option's name in one row on a light grey strip (a shade
 * deeper at its foot), which stands off the white canvas, and
 * pressing one drops down its menu, the choice made ticked. Each option is
 * capped in width, so all of them stay in one row, in view. Each name has what it is set to beneath it. The action
 * is its own button under the bar, centred on the flow and linked to the
 * bar by an arrow, as each step leads to the next.
 *
 * `disabled`, once a step has run, keeps the bar as a record of what was
 * chosen, faded: its options no longer open, and there is no action. With no options there is only the action, and nothing once run.
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

  return (
    <div className="flex flex-col items-center">
      {entries.length > 0 && (
        <div
          role="menubar"
          aria-label="Options"
          className="flex max-w-full items-stretch justify-center gap-0 rounded-[18px] bg-linear-to-b from-group to-field p-1.5 shadow-lift"
        >
          {entries.map(([key, setting]) => (
            <Title
              key={key}
              setting={setting}
              value={values[key]}
              readOnly={disabled}
              onChange={(value) => onChange(key, value)}
              onFile={(file) => onFile?.(key, file)}
            />
          ))}
        </div>
      )}
      {!disabled && entries.length > 0 && <FlowLink />}
      {!disabled && (
        <button
          type="button"
          disabled={busy}
          onClick={onRun}
          className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:cursor-default disabled:opacity-40"
        >
          {action}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
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
      return setting.summary
        ? setting.summary(String(value))
        : String(value) || null;
    case 'info':
      return setting.value || null;
    case 'slider':
      return `${setting.label} ${value}%`;
    case 'toggle':
      return value ? setting.label : null;
    case 'number':
      return setting.time
        ? `${setting.label} ${clock(Number(value))}`
        : `${setting.label} ${value}${setting.unit ?? ''}`;
    case 'text':
    case 'file':
      return String(value) || null;
    default:
      return null;
  }
}

/**
 * An option in the bar: lit under the pointer, and held lit while its menu
 * is open, as a menu bar's titles are. Its value may widen it to 128px (the
 * cap is on the value, below, not on the option); one longer is cut short,
 * the tooltip saying it all. Its name is never cut: the option is never
 * narrower than its name, however long, and in a narrow window only the
 * values give way, so the options stay in one row.
 */
const title =
  'flex cursor-default flex-col items-start rounded-[12px] px-2.5 py-2 text-left whitespace-nowrap enabled:hover:bg-ink/[0.07] aria-expanded:bg-ink/[0.12] disabled:opacity-50';
/** A field inside a menu: a row of its own, as wide as the menu. */
const field =
  'h-[26px] w-full min-w-0 rounded-[7px] bg-canvas/80 px-2 text-ink outline-none select-text placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40 disabled:bg-transparent';

/** What an option is set to, as its title's tooltip says it. */
function shownValue(setting: Setting, value: SettingValue) {
  switch (setting.kind) {
    case 'slider':
      return `${value}%`;
    case 'toggle':
      return value ? 'On' : 'Off';
    case 'number':
      return setting.time
        ? clock(Number(value))
        : `${value}${setting.unit ?? ''}`;
    case 'password':
      return value ? 'Set' : 'None';
    case 'info':
      return setting.value;
    default:
      return String(value) || 'None';
  }
}

/** One option: its name in the bar, and the menu it opens. */
function Title({
  setting,
  value,
  readOnly,
  onChange,
  onFile,
}: {
  setting: Setting;
  value: SettingValue;
  readOnly: boolean;
  onChange: (value: SettingValue) => void;
  onFile: (file: File) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const menu = {
    label: setting.label,
    hint: `${setting.label}: ${shownValue(setting, value)}`,
    align: 'start' as const,
    // Once run, it shows what was chosen but no longer opens.
    disabled: readOnly,
    className: title,
    // Its name, ending in a chevron as it opens a menu, and what it is set
    // to beneath, in a softer grey.
    children: (
      <>
        <span className="flex items-center gap-1 text-[13px] leading-4 font-medium text-ink">
          {setting.label}
          <ChevronDown
            size={12}
            strokeWidth={2.25}
            className="shrink-0 text-ink-faint"
          />
        </span>
        {/* The value fills the option's width but sets none of it, so
            it is cut short rather than the name... */}
        <span className="mt-0.5 w-0 min-w-full truncate text-[12px] leading-4 text-ink-soft">
          {shownValue(setting, value)}
        </span>
        {/* ...while this unseen copy widens the option to fit it, up to
            the cap. It may break anywhere, so it never stops the option
            narrowing to its name. */}
        <span
          aria-hidden
          className="h-0 max-w-27 overflow-hidden text-[12px] break-all whitespace-normal"
        >
          {shownValue(setting, value)}
        </span>
      </>
    ),
  };

  switch (setting.kind) {
    case 'select':
      return (
        <SelectMenu
          {...menu}
          value={String(value)}
          choices={setting.options.map((option) => [option, option])}
          onChange={onChange}
        />
      );
    case 'slider':
      // Picks from tens, keeping its own value if it is between.
      return (
        <SelectMenu
          {...menu}
          value={String(value)}
          choices={[...new Set([...tens, Number(value)])]
            .sort((a, b) => b - a)
            .map((option) => [String(option), `${option}%`])}
          onChange={(chosen) => onChange(Number(chosen))}
        />
      );
    case 'toggle':
      return (
        <SelectMenu
          {...menu}
          value={value ? 'on' : 'off'}
          choices={[
            ['on', 'On'],
            ['off', 'Off'],
          ]}
          onChange={(chosen) => onChange(chosen === 'on')}
        />
      );
    case 'info':
      // Nothing to choose: the one thing it can be, ticked.
      return (
        <SelectMenu
          {...menu}
          readOnly
          value={setting.value}
          choices={[[setting.value, setting.value]]}
          onChange={() => {}}
        />
      );
    case 'number':
    case 'text':
    case 'password':
      // A menu holding a field, typed into in place.
      if (setting.kind === 'number' && setting.time) {
        return (
          <SelectMenu
            {...menu}
            value=""
            choices={[]}
            onChange={() => {}}
            field={
              <label className="flex min-w-48 items-center p-[3px]">
                <TimeField
                  label={setting.label}
                  seconds={Number(value)}
                  disabled={readOnly}
                  onChange={onChange}
                />
              </label>
            }
          />
        );
      }
      return (
        <SelectMenu
          {...menu}
          value=""
          choices={[]}
          onChange={() => {}}
          field={
            <label className="flex min-w-48 items-center gap-1.5 p-[3px] text-ink-soft">
              <input
                type={setting.kind}
                min={setting.kind === 'number' ? 0 : undefined}
                disabled={readOnly}
                aria-label={setting.label}
                value={
                  setting.kind === 'number' ? Number(value) : String(value)
                }
                placeholder={
                  setting.kind === 'number'
                    ? undefined
                    : (setting.placeholder ?? setting.label)
                }
                onChange={(event) =>
                  onChange(
                    setting.kind === 'number'
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
                className={field}
              />
              {setting.kind === 'number' && setting.unit}
            </label>
          }
        />
      );
    case 'file':
      // The file chosen, ticked, and an item to choose another.
      return (
        <>
          <SelectMenu
            {...menu}
            value={String(value)}
            choices={[
              ...(value
                ? [[String(value), String(value)] as [string, string]]
                : []),
              ...(readOnly
                ? []
                : [[chooseFile, 'Choose File…'] as [string, string]]),
            ]}
            onChange={(chosen) => {
              if (chosen === chooseFile) picker.current?.click();
            }}
          />
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
    default:
      return null;
  }
}

/** The file menu's "Choose File…": a value no file name can be. */
const chooseFile = '\u0000choose';

const tens = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

/**
 * A time option's field: shows "1:05.25", and is typed into the same way
 * (or as plain seconds). What is typed is kept once it is left or Enter is
 * pressed, if it is a time; Escape puts back what it was.
 */
function TimeField({
  label,
  seconds,
  disabled,
  onChange,
}: {
  label: string;
  seconds: number;
  disabled: boolean;
  onChange: (seconds: number) => void;
}) {
  // What is typed, while it is being typed; else the value, as a time.
  const [typed, setTyped] = useState<string | null>(null);
  const latest = useRef<string | null>(null);
  const type = (text: string | null) => {
    latest.current = text;
    setTyped(text);
  };
  const change = useRef(onChange);
  change.current = onChange;
  const commit = () => {
    const parsed = latest.current === null ? null : parseClock(latest.current);
    if (parsed !== null) change.current(parsed);
    return parsed;
  };
  // A press outside closes the menu before the field hears it is left:
  // what was typed is kept then too.
  useEffect(
    () => () => {
      commit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const invalid = typed !== null && parseClock(typed) === null;
  return (
    <input
      type="text"
      inputMode="decimal"
      spellCheck={false}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid}
      title="Minutes:seconds, as 1:05.25, or seconds"
      value={typed ?? clock(seconds)}
      onFocus={(event) => {
        type(clock(seconds));
        event.currentTarget.select();
      }}
      onChange={(event) => type(event.target.value)}
      onBlur={() => {
        commit();
        type(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const parsed = commit();
          if (parsed !== null) type(clock(parsed));
        } else if (event.key === 'Escape') {
          type(null);
        }
      }}
      className={`${field} tabular-nums aria-invalid:ring-2 aria-invalid:ring-brand/50`}
    />
  );
}
