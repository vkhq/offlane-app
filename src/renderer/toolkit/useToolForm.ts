import {
  type OptionValues,
  type Options,
  type SettingValue,
  defaultValues,
} from '../../shared/tools';
import { useTabState } from '../tabState';

/**
 * A tool's option values, by key, kept with the tab like `useTabState`. A
 * value saved under a key the options no longer have is dropped, and a new
 * option starts at its default, so options can be added, removed, renamed or
 * reordered freely.
 */
export function useToolForm<O extends Options>(options: O) {
  const [saved, setSaved] = useTabState<Record<string, SettingValue>>(
    'values',
    () => defaultValues(options),
  );
  const values = { ...defaultValues(options) } as Record<string, SettingValue>;
  for (const key of Object.keys(options)) {
    if (key in saved) values[key] = saved[key];
  }
  const setValue = (key: keyof O & string, value: SettingValue) =>
    setSaved((current) => ({ ...current, [key]: value }));
  return [values as OptionValues<O>, setValue] as const;
}
